import express from 'express';
import { createSharkyClient, createProvider, OfferedLoan } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COLLECTIONS_PATH = path.join(__dirname, '..', 'config', 'collections.json');
const UPDATE_INTERVAL = 60_000; // 1 минута

interface OrderBookData {
  pubkey: string;
  collectionName: string;
  apr: number;
  durationDays: number | null;
  feePercent: number;
  offers: OfferData[];
  totalLiquidity: number; // в SOL
}

interface OfferData {
  pubkey: string;
  principalSol: number;
  lender: string;
}

let orderbooks: OrderBookData[] = [];
let lastUpdate: Date | null = null;
let isUpdating = false;

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
      });
    }

    // Сортируем offers по размеру и оставляем только топ-4
    for (const [key, offers] of offersByOrderbook) {
      offers.sort((a, b) => b.principalSol - a.principalSol);
      offersByOrderbook.set(key, offers.slice(0, 4));
    }

    const newOrderbooks: OrderBookData[] = [];

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

      newOrderbooks.push({
        pubkey: orderbookKey,
        collectionName,
        apr,
        durationDays,
        feePercent: orderBook.feePermillicentage / 1000,
        offers,
        totalLiquidity,
      });
    }

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
      gap: 15px;
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
            ob.offers.map(function(offer) {
              return '<div class="offer">' +
                '<span class="offer-amount">' + offer.principalSol.toFixed(2) + ' SOL</span>' +
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
              '<div class="stat-value liquidity">' + ob.totalLiquidity.toFixed(2) + '</div>' +
              '<div class="stat-label">SOL Available</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value">' + ob.offers.length + '</div>' +
              '<div class="stat-label">Offers</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value">' + (ob.durationDays || 'N/A') + '</div>' +
              '<div class="stat-label">Days</div>' +
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
