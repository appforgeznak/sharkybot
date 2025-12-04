import express from 'express';
import { createSharkyClient, createProvider, OfferedLoan } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COLLECTIONS_PATH = path.join(__dirname, '..', 'config', 'collections.json');
const UPDATE_INTERVAL = 60_000; // 1 минута
const ME_API_BASE = 'https://api-mainnet.magiceden.dev/v2';

// Маппинг названий коллекций на символы Magic Eden
const COLLECTION_SYMBOLS: Record<string, string> = {
  'DeGods': 'degods',
  'Mad Lads': 'mad_lads',
  'Tensorians': 'tensorians',
  'Famous Fox Federation': 'famous_fox_federation',
  'Claynosaurz': 'claynosaurz',
};

interface CollectionStats {
  floorPrice: number | null; // в SOL
  topBid: number | null; // в SOL (лучший bid на ME)
  listedCount: number;
  avgPrice24hr: number | null;
  volumeAll: number | null;
}

interface OrderBookData {
  pubkey: string;
  collectionName: string;
  apr: number;
  durationDays: number | null;
  feePercent: number;
  offers: OfferData[];
  totalLiquidity: number; // в SOL
  floorPrice: number | null; // в SOL
  topOffer: number | null; // в SOL (лучший sharky offer)
  meTopBid: number | null; // в SOL (лучший bid на Magic Eden)
  // Расчётные поля
  ltv: number | null; // Loan to Value в % (topOffer / floorPrice * 100)
  floorDiff: number | null; // Разница floor - topOffer в SOL
  floorDiffPercent: number | null; // Разница в %
  topBidDiff: number | null; // Разница meTopBid - topOffer в SOL  
  topBidDiffPercent: number | null; // Разница в %
}

interface OfferData {
  pubkey: string;
  principalSol: number;
  lender: string;
  diffFromTop: number | null; // разница от top offer в SOL
  diffFromTopPercent: number | null; // разница от top offer в %
}

let orderbooks: OrderBookData[] = [];
let lastUpdate: Date | null = null;
let isUpdating = false;
const collectionStatsCache = new Map<string, CollectionStats>();

interface MEStatsResponse {
  floorPrice?: number;
  listedCount?: number;
  avgPrice24hr?: number;
  volumeAll?: number;
}

interface MEPoolResponse {
  results: Array<{
    spotPrice: number;
    poolType: string;
    expiry: number;
    buysidePaymentAmount: number;
  }>;
}

async function fetchCollectionStats(collectionName: string): Promise<CollectionStats | null> {
  const symbol = COLLECTION_SYMBOLS[collectionName];
  if (!symbol) return null;

  try {
    // Получаем stats и MMM pools параллельно
    const [statsRes, poolsRes] = await Promise.all([
      fetch(`${ME_API_BASE}/collections/${symbol}/stats`),
      fetch(`${ME_API_BASE}/mmm/pools?collectionSymbol=${symbol}&limit=50`),
    ]);

    const statsData = statsRes.ok ? await statsRes.json() as MEStatsResponse : null;
    const poolsData = poolsRes.ok ? await poolsRes.json() as MEPoolResponse : null;

    // Находим лучший активный bid из pools
    // ME берёт ~2% комиссию при instant sell
    const ME_FEE = 0.02;
    let topBid: number | null = null;
    if (poolsData?.results) {
      const now = Math.floor(Date.now() / 1000);
      const activeBids = poolsData.results
        .filter(p => 
          (p.poolType === 'buy_sided' || p.poolType === 'two_sided') && 
          p.buysidePaymentAmount > 0 &&
          (p.expiry === 0 || p.expiry > now) && // не просрочен
          p.buysidePaymentAmount >= p.spotPrice // достаточно средств для покупки
        )
        .map(p => (p.spotPrice / LAMPORTS_PER_SOL) * (1 - ME_FEE)); // net price после комиссии
      
      if (activeBids.length > 0) {
        topBid = Math.max(...activeBids);
      }
    }

    return {
      floorPrice: statsData?.floorPrice ? statsData.floorPrice / LAMPORTS_PER_SOL : null,
      topBid,
      listedCount: statsData?.listedCount || 0,
      avgPrice24hr: statsData?.avgPrice24hr ? statsData.avgPrice24hr / LAMPORTS_PER_SOL : null,
      volumeAll: statsData?.volumeAll ? statsData.volumeAll / LAMPORTS_PER_SOL : null,
    };
  } catch (err) {
    console.warn(`Failed to fetch ME stats for ${collectionName}:`, err);
    return null;
  }
}

async function fetchOrderbooks() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    console.log('[' + new Date().toISOString() + '] Fetching orderbooks and offers...');

    const collections: string[] = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf-8'));
    const collectionsSet = new Set(collections.map(c => c.toLowerCase()));

    const wallet = Keypair.generate();
    const connection = new Connection(RPC_URL, 'confirmed');

    const provider = createProvider(connection, {
      publicKey: wallet.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
    });

    const sharky = createSharkyClient(provider, undefined, 'mainnet');

    // Загружаем orderbooks и nftLists сначала
    const [allOrderBooks, nftLists] = await Promise.all([
      sharky.fetchAllOrderBooks({ program: sharky.program }),
      sharky.fetchAllNftLists({ program: sharky.program }),
    ]);

    // Небольшая пауза перед загрузкой loans
    await new Promise(resolve => setTimeout(resolve, 2000));

    let allLoans: Awaited<ReturnType<typeof sharky.fetchAllLoans>> = [];
    try {
      allLoans = await sharky.fetchAllLoans({ program: sharky.program });
    } catch (err) {
      console.warn('Failed to fetch loans (rate limit?), continuing without offers');
    }

    const nftListMap = new Map(nftLists.map(list => [list.pubKey.toBase58(), list.collectionName]));

    // Фильтруем только offered loans (не taken)
    const offeredLoans = allLoans.filter((loan): loan is OfferedLoan => loan.state === 'offered');
    
    // Группируем offers по orderbook
    const offersByOrderbook = new Map<string, OfferData[]>();
    for (const loan of offeredLoans) {
      const orderbookKey = loan.data.orderBook.toBase58();
      if (!offersByOrderbook.has(orderbookKey)) {
        offersByOrderbook.set(orderbookKey, []);
      }
      offersByOrderbook.get(orderbookKey)!.push({
        pubkey: loan.pubKey.toBase58(),
        principalSol: loan.data.principalLamports.toNumber() / LAMPORTS_PER_SOL,
        lender: loan.data.loanState.offer?.offer.lenderWallet.toBase58() || '',
        diffFromTop: null,
        diffFromTopPercent: null,
      });
    }

    // Сортируем offers по размеру, рассчитываем разницу от top и оставляем только топ-4
    for (const [key, offers] of offersByOrderbook) {
      offers.sort((a, b) => b.principalSol - a.principalSol);
      const topOfferValue = offers[0]?.principalSol || 0;
      
      // Рассчитываем разницу от top для каждого оффера
      for (const offer of offers) {
        offer.diffFromTop = topOfferValue - offer.principalSol;
        offer.diffFromTopPercent = topOfferValue > 0 
          ? (offer.diffFromTop / topOfferValue) * 100 
          : 0;
      }
      
      offersByOrderbook.set(key, offers.slice(0, 4));
    }

    let newOrderbooks: OrderBookData[] = [];

    for (const orderBook of allOrderBooks) {
      let collectionName = '';

      if (orderBook.orderBookType.nftList) {
        collectionName = nftListMap.get(orderBook.orderBookType.nftList.listAccount.toBase58()) || '';
      }

      if (!collectionName || !collectionsSet.has(collectionName.toLowerCase())) {
        continue;
      }

      const apr = orderBook.apy.fixed?.apy ? orderBook.apy.fixed.apy / 1000 : 0;
      const durationSeconds = orderBook.loanTerms.fixed?.terms.time?.duration?.toNumber();
      const durationDays = durationSeconds ? durationSeconds / (24 * 60 * 60) : null;

      const orderbookKey = orderBook.pubKey.toBase58();
      const offers = offersByOrderbook.get(orderbookKey) || [];
      const totalLiquidity = offers.reduce((sum, o) => sum + o.principalSol, 0);
      const topOffer = offers.length > 0 ? offers[0].principalSol : null;

      newOrderbooks.push({
        pubkey: orderbookKey,
        collectionName,
        apr,
        durationDays,
        feePercent: orderBook.feePermillicentage / 1000,
        offers,
        totalLiquidity,
        floorPrice: null,
        topOffer,
        meTopBid: null,
        ltv: null,
        floorDiff: null,
        floorDiffPercent: null,
        topBidDiff: null,
        topBidDiffPercent: null,
      });
    }

    // Получаем floor price из Magic Eden для каждой уникальной коллекции
    const uniqueCollections = [...new Set(newOrderbooks.map(ob => ob.collectionName))];
    for (const collName of uniqueCollections) {
      const stats = await fetchCollectionStats(collName);
      if (stats) {
        collectionStatsCache.set(collName, stats);
      }
    }

    // Заполняем floor price, top bid и рассчитываем метрики
    for (const ob of newOrderbooks) {
      const stats = collectionStatsCache.get(ob.collectionName);
      if (stats) {
        ob.floorPrice = stats.floorPrice;
        ob.meTopBid = stats.topBid;
        
        // Рассчитываем LTV и разницу floor - offer
        if (ob.floorPrice && ob.topOffer) {
          ob.ltv = (ob.topOffer / ob.floorPrice) * 100;
          ob.floorDiff = ob.floorPrice - ob.topOffer;
          ob.floorDiffPercent = (ob.floorDiff / ob.floorPrice) * 100;
        }
        
        // Рассчитываем разницу meTopBid - sharky topOffer
        if (ob.meTopBid && ob.topOffer) {
          ob.topBidDiff = ob.meTopBid - ob.topOffer;
          ob.topBidDiffPercent = (ob.topBidDiff / ob.meTopBid) * 100;
        }
      }
    }

    // Фильтруем только 7-дневные orderbooks
    newOrderbooks = newOrderbooks.filter(ob => ob.durationDays === 7);

    // Сортируем по ликвидности (больше первым), потом по имени
    newOrderbooks.sort((a, b) => {
      if (b.totalLiquidity !== a.totalLiquidity) {
        return b.totalLiquidity - a.totalLiquidity;
      }
      return a.collectionName.localeCompare(b.collectionName);
    });

    orderbooks = newOrderbooks;
    lastUpdate = new Date();

    const totalOffers = newOrderbooks.reduce((sum, ob) => sum + ob.offers.length, 0);
    console.log('[' + new Date().toISOString() + '] Found ' + orderbooks.length + ' orderbooks with ' + totalOffers + ' offers');
  } catch (err) {
    console.error('Error fetching orderbooks:', err);
  } finally {
    isUpdating = false;
  }
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SharkyBot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #1a1a2e;
    }
    
    h1 {
      font-size: 28px;
      background: linear-gradient(135deg, #00d4ff, #7b2ff7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .status {
      display: flex;
      align-items: center;
      gap: 15px;
      font-size: 13px;
      color: #888;
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00ff88;
      animation: pulse 2s infinite;
    }
    
    .status-dot.updating {
      background: #ffaa00;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .refresh-btn {
      background: linear-gradient(135deg, #7b2ff7, #00d4ff);
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .refresh-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(123, 47, 247, 0.4);
    }
    
    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 20px;
    }
    
    .card {
      background: linear-gradient(145deg, #12121a, #1a1a2e);
      border: 1px solid #2a2a4e;
      border-radius: 12px;
      padding: 20px;
      transition: transform 0.2s, border-color 0.2s;
    }
    
    .card:hover {
      border-color: #7b2ff7;
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
    }
    
    .collection-name {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
    }
    
    .apr {
      font-size: 20px;
      font-weight: 700;
      color: #00ff88;
    }
    
    .card-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid #2a2a4e;
    }
    
    .stat {
      text-align: center;
    }
    
    .stat-value {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    
    .stat-value.liquidity {
      color: #00d4ff;
    }
    
    .stat-value.floor {
      color: #ff9500;
    }
    
    .stat-value.ltv {
      color: #00ff88;
    }
    
    .stat-value.me-bid {
      color: #e040fb;
    }
    
    .stat-value.diff-positive {
      color: #ff4444;
    }
    
    .stat-value.diff-negative {
      color: #00ff88;
    }
    
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 15px;
      padding: 10px;
      background: #0a0a0f;
      border-radius: 8px;
    }
    
    .metric {
      text-align: center;
    }
    
    .metric-value {
      font-size: 14px;
      font-weight: 600;
    }
    
    .metric-label {
      font-size: 9px;
      color: #666;
      text-transform: uppercase;
    }
    
    .stat-label {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .offers-section {
      margin-top: 10px;
    }
    
    .offers-title {
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .offers-list {
      max-height: 150px;
      overflow-y: auto;
    }
    
    .offer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #0a0a0f;
      border-radius: 6px;
      margin-bottom: 5px;
      font-size: 12px;
    }
    
    .offer-amount {
      color: #00ff88;
      font-weight: 600;
    }
    
    .offer-lender {
      color: #666;
      cursor: pointer;
    }
    
    .offer-lender:hover {
      color: #00d4ff;
    }
    
    .offer-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    
    .offer-badge.top {
      background: #00ff88;
      color: #000;
    }
    
    .offer-diff {
      font-size: 10px;
      color: #ff6b6b;
    }
    
    .no-offers {
      color: #444;
      font-size: 12px;
      text-align: center;
      padding: 20px;
    }
    
    .empty {
      text-align: center;
      padding: 60px;
      color: #666;
    }
    
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #333;
      border-top-color: #7b2ff7;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .summary {
      display: flex;
      gap: 30px;
      margin-bottom: 25px;
      padding: 15px 20px;
      background: linear-gradient(145deg, #12121a, #1a1a2e);
      border-radius: 12px;
      border: 1px solid #2a2a4e;
    }
    
    .summary-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .summary-value {
      font-size: 20px;
      font-weight: 700;
      color: #00d4ff;
    }
    
    .summary-label {
      font-size: 11px;
      color: #666;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦈 SharkyBot</h1>
      <div class="status">
        <div class="status-dot" id="statusDot"></div>
        <span id="lastUpdate">Loading...</span>
        <button class="refresh-btn" id="refreshBtn" onclick="refresh()">Refresh</button>
      </div>
    </header>
    
    <div class="summary" id="summary"></div>
    
    <div class="grid" id="grid">
      <div class="empty"><div class="loading"></div></div>
    </div>
  </div>

  <script>
    async function fetchData() {
      try {
        const res = await fetch('/api/orderbooks');
        const data = await res.json();
        render(data);
      } catch (err) {
        console.error(err);
      }
    }
    
    async function refresh() {
      const btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      btn.textContent = 'Updating...';
      document.getElementById('statusDot').classList.add('updating');
      
      try {
        await fetch('/api/refresh', { method: 'POST' });
        await fetchData();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh';
        document.getElementById('statusDot').classList.remove('updating');
      }
    }
    
    function render(data) {
      const grid = document.getElementById('grid');
      const summary = document.getElementById('summary');
      const statusDot = document.getElementById('statusDot');
      const lastUpdate = document.getElementById('lastUpdate');
      
      if (data.isUpdating) {
        statusDot.classList.add('updating');
      } else {
        statusDot.classList.remove('updating');
      }
      
      if (data.lastUpdate) {
        const date = new Date(data.lastUpdate);
        lastUpdate.textContent = 'Updated: ' + date.toLocaleTimeString();
      }
      
      // Summary
      const totalOffers = data.orderbooks.reduce(function(sum, ob) { return sum + ob.offers.length; }, 0);
      const totalLiquidity = data.orderbooks.reduce(function(sum, ob) { return sum + ob.totalLiquidity; }, 0);
      
      summary.innerHTML = 
        '<div class="summary-item">' +
          '<span class="summary-value">' + data.orderbooks.length + '</span>' +
          '<span class="summary-label">Collections</span>' +
        '</div>' +
        '<div class="summary-item">' +
          '<span class="summary-value">' + totalOffers + '</span>' +
          '<span class="summary-label">Active Offers</span>' +
        '</div>' +
        '<div class="summary-item">' +
          '<span class="summary-value">' + totalLiquidity.toFixed(2) + ' SOL</span>' +
          '<span class="summary-label">Total Liquidity</span>' +
        '</div>';
      
      if (data.orderbooks.length === 0) {
        grid.innerHTML = '<div class="empty">No orderbooks found</div>';
        return;
      }
      
      grid.innerHTML = data.orderbooks.map(function(ob) {
        var offersHtml = '';
        if (ob.offers.length === 0) {
          offersHtml = '<div class="no-offers">No active offers</div>';
        } else {
          offersHtml = '<div class="offers-list">' + 
            ob.offers.map(function(offer, idx) {
              var diffText = idx === 0 ? '<span class="offer-badge top">TOP</span>' : 
                '<span class="offer-diff">-' + offer.diffFromTop.toFixed(2) + ' (' + offer.diffFromTopPercent.toFixed(1) + '%)</span>';
              return '<div class="offer">' +
                '<span class="offer-amount">' + offer.principalSol.toFixed(2) + ' SOL</span>' +
                diffText +
                '<span class="offer-lender" data-pubkey="' + offer.lender + '" title="Click to copy">' + 
                  offer.lender.slice(0, 4) + '...' + offer.lender.slice(-4) + 
                '</span>' +
              '</div>';
            }).join('') +
          '</div>';
        }
        
        return '<div class="card">' +
          '<div class="card-header">' +
            '<span class="collection-name">' + ob.collectionName + '</span>' +
            '<span class="apr">' + ob.apr.toFixed(1) + '% APR</span>' +
          '</div>' +
          '<div class="card-stats">' +
            '<div class="stat">' +
              '<div class="stat-value floor">' + (ob.floorPrice ? ob.floorPrice.toFixed(4) : 'N/A') + '</div>' +
              '<div class="stat-label">Floor</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value me-bid">' + (ob.meTopBid ? ob.meTopBid.toFixed(4) : 'N/A') + '</div>' +
              '<div class="stat-label">ME Top Bid</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value ltv">' + (ob.ltv ? ob.ltv.toFixed(1) + '%' : 'N/A') + '</div>' +
              '<div class="stat-label">LTV</div>' +
            '</div>' +
          '</div>' +
          '<div class="metrics-row">' +
            '<div class="metric">' +
              '<div class="metric-value ' + (ob.floorDiff > 0 ? 'diff-positive' : 'diff-negative') + '">' + 
                (ob.floorDiff !== null ? (ob.floorDiff > 0 ? '+' : '') + ob.floorDiff.toFixed(4) : 'N/A') + 
              '</div>' +
              '<div class="metric-label">Floor - Sharky</div>' +
            '</div>' +
            '<div class="metric">' +
              '<div class="metric-value ' + (ob.topBidDiff > 0 ? 'diff-positive' : 'diff-negative') + '">' + 
                (ob.topBidDiff !== null ? (ob.topBidDiff > 0 ? '+' : '') + ob.topBidDiff.toFixed(4) : 'N/A') + 
              '</div>' +
              '<div class="metric-label">ME Bid - Sharky</div>' +
            '</div>' +
          '</div>' +
          '<div class="offers-section">' +
            '<div class="offers-title">Active Offers</div>' +
            offersHtml +
          '</div>' +
        '</div>';
      }).join('');
      
      document.querySelectorAll('[data-pubkey]').forEach(function(el) {
        el.addEventListener('click', function() {
          navigator.clipboard.writeText(el.getAttribute('data-pubkey'));
        });
      });
    }
    
    fetchData();
    setInterval(fetchData, 30000);
  </script>
</body>
</html>`;

const app = express();

app.get('/api/orderbooks', (req, res) => {
  res.json({
    orderbooks,
    lastUpdate: lastUpdate?.toISOString(),
    isUpdating,
  });
});

app.post('/api/refresh', async (req, res) => {
  await fetchOrderbooks();
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send(HTML_PAGE);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  fetchOrderbooks();
  setInterval(fetchOrderbooks, UPDATE_INTERVAL);
});
