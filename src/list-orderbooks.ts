import { collectionNameByOrderBookPubKey, createSharkyClient, createProvider, OfferedLoan } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COLLECTIONS_PATH = path.join(__dirname, '..', 'config', 'collections.json');
const ME_API_BASE = 'https://api-mainnet.magiceden.dev/v2';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 60000);
const DUMP_LIST_ACCOUNTS = process.argv.includes('--dump-list-accounts');
const dumpTopIdx = process.argv.indexOf('--dump-top');
const DUMP_TOP = dumpTopIdx !== -1 ? Number(process.argv[dumpTopIdx + 1]) : 50;
const dumpMinIdx = process.argv.indexOf('--dump-min-liquidity');
const DUMP_MIN_LIQUIDITY = dumpMinIdx !== -1 ? Number(process.argv[dumpMinIdx + 1]) : 0;

const COLLECTION_SYMBOLS: Record<string, string> = {
  'DeGods': 'degods',
  'Mad Lads': 'mad_lads',
  'Tensorians': 'tensorians',
  'Famous Fox Federation': 'famous_fox_federation',
  'Claynosaurz': 'claynosaurz',
};

interface CollectionStats {
  floorPrice: number | null; // in SOL
  topBid: number | null; // ME instant-sell top bid in SOL
  listedCount: number;
  avgPrice24hr: number | null;
  volumeAll: number | null;
}

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

interface OfferData {
  pubkey: string;
  principalSol: number;
  lender: string;
  diffFromTop: number | null;
  diffFromTopPercent: number | null;
}

interface CollectionConfig {
  name: string;
  listAccount?: string;
  collectionKey?: string;
}

interface CollectionData {
  collectionName: string;
  collectionId?: string;
  collectionType?: 'nftList' | 'collection';
  durations?: number[];
  orderbookCount?: number;
  offers: OfferData[];
  offerCount: number;
  totalLiquidity: number; // in SOL
  bestOffer: number | null; // in SOL
  floorPrice: number | null; // in SOL
  meTopBid: number | null; // in SOL
  floorDiff: number | null;
  floorDiffPercent: number | null;
  topBidDiff: number | null;
  topBidDiffPercent: number | null;
}

async function fetchCollectionStats(collectionName: string): Promise<CollectionStats | null> {
  const symbol = COLLECTION_SYMBOLS[collectionName];
  if (!symbol) return null;

  try {
    const [statsRes, poolsRes] = await Promise.all([
      fetch(`${ME_API_BASE}/collections/${symbol}/stats`),
      fetch(`${ME_API_BASE}/mmm/pools?collectionSymbol=${symbol}&limit=50`),
    ]);

    const statsData = statsRes.ok ? await statsRes.json() as MEStatsResponse : null;
    const poolsData = poolsRes.ok ? await poolsRes.json() as MEPoolResponse : null;

    const ME_FEE = 0.02;
    let topBid: number | null = null;
    if (poolsData?.results) {
      const now = Math.floor(Date.now() / 1000);
      const activeBids = poolsData.results
        .filter(p =>
          (p.poolType === 'buy_sided' || p.poolType === 'two_sided') &&
          p.buysidePaymentAmount > 0 &&
          (p.expiry === 0 || p.expiry > now) &&
          p.buysidePaymentAmount >= p.spotPrice
        )
        .map(p => (p.spotPrice / LAMPORTS_PER_SOL) * (1 - ME_FEE));

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

function formatSol(value: number | null, decimals = 4): string {
  if (value === null) return 'N/A';
  return `${value.toFixed(decimals)} SOL`;
}

function formatDelta(delta: number | null, percent: number | null): string {
  if (delta === null || percent === null) return 'N/A';
  const sign = delta > 0 ? '+' : '';
  const pctSign = percent > 0 ? '+' : '';
  return `${sign}${delta.toFixed(4)} SOL (${pctSign}${percent.toFixed(1)}%)`;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function loadCollectionsConfig(): any[] {
  if (!fs.existsSync(COLLECTIONS_PATH)) {
    console.warn(`Collections config not found: ${COLLECTIONS_PATH}. Using all collections.`);
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf-8'));
    if (!Array.isArray(raw)) {
      console.warn('Collections config must be an array. Using all collections.');
      return [];
    }
    return raw;
  } catch (err) {
    console.warn('Failed to parse collections config. Using all collections.', err);
    return [];
  }
}

function normalizeListAccount(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'REPLACE_WITH_LIST_ACCOUNT') {
    return '';
  }
  return trimmed;
}

type NameRule = {
  match: string;
  display: string;
  duration?: number;
};

function loadCollectionsWhitelist() {
  const listAccountSet = new Set<string>();
  const collectionKeySet = new Set<string>();
  const listAccountToName = new Map<string, string>();
  const collectionKeyToName = new Map<string, string>();
  const nameRules: NameRule[] = [];
  const raw = loadCollectionsConfig();
  if (raw.length === 0) {
    return {
      enforceWhitelist: false,
      listAccountSet,
      collectionKeySet,
      listAccountToName,
      collectionKeyToName,
      nameRules,
    };
  }

  for (const item of raw) {
    if (typeof item === 'string') {
      const listAccount = normalizeListAccount(item);
      if (listAccount) {
        listAccountSet.add(listAccount);
        listAccountToName.set(listAccount, `NFT List ${listAccount.slice(0, 8)}`);
        continue;
      }
      const matchName = item.trim();
      if (matchName) {
        nameRules.push({ match: matchName, display: matchName });
      }
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    let name = '';
    if (typeof item.name === 'string') {
      name = item.name.trim();
    } else if (typeof item.collectionName === 'string') {
      name = item.collectionName.trim();
    }

    const listAccount = normalizeListAccount(
      typeof item.listAccount === 'string' ? item.listAccount : ''
    );
    const collectionKey = typeof item.collectionKey === 'string' ? item.collectionKey.trim() : '';
    const matchName = typeof item.match === 'string'
      ? item.match.trim()
      : (typeof item.collectionName === 'string' ? item.collectionName.trim() : '');
    const duration = typeof item.duration === 'number' && Number.isFinite(item.duration)
      ? item.duration
      : undefined;

    if (listAccount) {
      listAccountSet.add(listAccount);
      listAccountToName.set(listAccount, name || `NFT List ${listAccount.slice(0, 8)}`);
    }

    if (collectionKey) {
      collectionKeySet.add(collectionKey);
      collectionKeyToName.set(collectionKey, name || `Collection ${collectionKey.slice(0, 8)}`);
    }

    if (!listAccount && !collectionKey) {
      const match = matchName || name;
      if (match) {
        nameRules.push({
          match,
          display: name || match,
          duration,
        });
      } else {
        console.warn(`Whitelist entry missing name/listAccount/collectionKey: ${JSON.stringify(item)}`);
      }
    }
  }

  const enforceWhitelist = listAccountSet.size > 0 || collectionKeySet.size > 0 || nameRules.length > 0;
  if (enforceWhitelist) {
    console.log(
      `Loaded whitelist: ${listAccountSet.size} list accounts, ${collectionKeySet.size} collection keys, ${nameRules.length} name rules`
    );
  } else {
    console.warn('Whitelist loaded but no valid listAccount/collectionKey entries found.');
  }

  return { enforceWhitelist, listAccountSet, collectionKeySet, listAccountToName, collectionKeyToName, nameRules };
}

async function main() {
  let wallet: Keypair;

  const walletPathIdx = process.argv.indexOf('--wallet-path');
  const walletPath = walletPathIdx !== -1
    ? process.argv[walletPathIdx + 1]
    : path.join(process.env.HOME || '', '.config/solana/id.json');

  if (fs.existsSync(walletPath)) {
    const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    console.log('Wallet loaded:', wallet.publicKey.toBase58());
  } else {
    wallet = Keypair.generate();
    console.log('No wallet found, using dummy keypair for read-only operations');
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  const provider = createProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
  });

  const sharky = createSharkyClient(provider, undefined, 'mainnet');
  const whitelist = loadCollectionsWhitelist();
  const { enforceWhitelist, listAccountSet, collectionKeySet, listAccountToName, collectionKeyToName, nameRules } = whitelist;
  const applyWhitelist = enforceWhitelist && !DUMP_LIST_ACCOUNTS;

  console.log('\nFetching orderbooks, lists, loans...\n');

  const allOrderBooks = await withTimeout(
    sharky.fetchAllOrderBooks({ program: sharky.program }),
    'fetchAllOrderBooks'
  );

await new Promise(resolve => setTimeout(resolve, 2000));

  let allLoans: Awaited<ReturnType<typeof sharky.fetchAllLoans>> = [];
  try {
    allLoans = await withTimeout(sharky.fetchAllLoans({ program: sharky.program }), 'fetchAllLoans');
  } catch (err) {
    console.warn('Failed to fetch loans (rate limit?), continuing without offers', err);
  }

  const offeredLoans = allLoans.filter((loan): loan is OfferedLoan => loan.state === 'offered');
  console.log(`Offered loans: ${offeredLoans.length}`);
  if (offeredLoans.length === 0) {
    console.warn('No offered loans found. This likely means RPC rate limits or fetchAllLoans returned empty.');
  }

  const offersByOrderbook = new Map<string, OfferData[]>();
  const liquidityByOrderbook = new Map<string, number>();
  const offerCountByOrderbook = new Map<string, number>();

  for (const loan of offeredLoans) {
    const orderbookKey = loan.data.orderBook.toBase58();
    if (!offersByOrderbook.has(orderbookKey)) {
      offersByOrderbook.set(orderbookKey, []);
    }

    const principalSol = loan.data.principalLamports.toNumber() / LAMPORTS_PER_SOL;
    offersByOrderbook.get(orderbookKey)!.push({
      pubkey: loan.pubKey.toBase58(),
      principalSol,
      lender: loan.data.loanState.offer?.offer.lenderWallet.toBase58() || '',
      diffFromTop: null,
      diffFromTopPercent: null,
    });

    liquidityByOrderbook.set(orderbookKey, (liquidityByOrderbook.get(orderbookKey) || 0) + principalSol);
    offerCountByOrderbook.set(orderbookKey, (offerCountByOrderbook.get(orderbookKey) || 0) + 1);
  }

  const collectionMap = new Map<string, {
    collectionName: string;
    collectionId: string;
    collectionType: 'nftList' | 'collection';
    durations: Set<number>;
    orderbookCount: number;
    offers: OfferData[];
    offerCount: number;
    totalLiquidity: number;
  }>();

  for (const orderBook of allOrderBooks) {
    let collectionName = '';
    let collectionId = '';
    let collectionType: 'nftList' | 'collection' | null = null;

    const orderbookKey = orderBook.pubKey.toBase58();
    const durationSeconds = orderBook.loanTerms.fixed?.terms.time?.duration?.toNumber();
    const durationDays = durationSeconds ? Math.round(durationSeconds / (24 * 60 * 60)) : null;
    const mappedName = collectionNameByOrderBookPubKey[orderbookKey] || '';
    let matchedRule: NameRule | null = null;
    if (mappedName) {
      for (const rule of nameRules) {
        if (rule.match === mappedName && (!rule.duration || rule.duration === durationDays)) {
          matchedRule = rule;
          break;
        }
      }
    }

    if (orderBook.orderBookType.nftList) {
      const listKey = orderBook.orderBookType.nftList.listAccount.toBase58();
      const listAllowed = listAccountSet.has(listKey);
      if (applyWhitelist && !listAllowed && !matchedRule) {
        continue;
      }
      collectionId = listKey;
      collectionType = 'nftList';
      collectionName = listAccountToName.get(listKey) || matchedRule?.display || mappedName || `NFT List ${listKey.slice(0, 8)}`;
    } else if (orderBook.orderBookType.collection) {
      const collectionKey = orderBook.orderBookType.collection.collectionKey.toBase58();
      const collectionAllowed = collectionKeySet.has(collectionKey);
      if (applyWhitelist && !collectionAllowed && !matchedRule) {
        continue;
      }
      collectionId = collectionKey;
      collectionType = 'collection';
      collectionName = collectionKeyToName.get(collectionKey) || matchedRule?.display || mappedName || `Collection ${collectionKey.slice(0, 8)}`;
    }

    if (!collectionName || !collectionId || !collectionType) continue;
    const offers = offersByOrderbook.get(orderbookKey) || [];
    offers.sort((a, b) => b.principalSol - a.principalSol);
    const topOffers = offers.slice(0, 4);
    const totalLiquidity = liquidityByOrderbook.get(orderbookKey) || 0;
    const offerCount = offerCountByOrderbook.get(orderbookKey) || 0;

    const entryKey = `${collectionType}:${collectionId}:${collectionName}`;
    if (!collectionMap.has(entryKey)) {
      collectionMap.set(entryKey, {
        collectionName,
        collectionId,
        collectionType,
        durations: new Set<number>(),
        orderbookCount: 0,
        offers: [],
        offerCount: 0,
        totalLiquidity: 0,
      });
    }

    const entry = collectionMap.get(entryKey)!;
    if (durationDays !== null) {
      entry.durations.add(durationDays);
    }
    entry.orderbookCount += 1;
    entry.offers.push(...topOffers);
    entry.offerCount += offerCount;
    entry.totalLiquidity += totalLiquidity;
  }

  let collections: CollectionData[] = Array.from(collectionMap.values()).map(entry => {
    entry.offers.sort((a, b) => b.principalSol - a.principalSol);
    const bestOffer = entry.offers[0]?.principalSol ?? null;

    if (bestOffer !== null) {
      for (const offer of entry.offers) {
        offer.diffFromTop = bestOffer - offer.principalSol;
        offer.diffFromTopPercent = bestOffer > 0
          ? (offer.diffFromTop / bestOffer) * 100
          : 0;
      }
    } else {
      for (const offer of entry.offers) {
        offer.diffFromTop = null;
        offer.diffFromTopPercent = null;
      }
    }

    return {
      collectionName: entry.collectionName,
      collectionId: entry.collectionId,
      collectionType: entry.collectionType,
      durations: Array.from(entry.durations).sort((a, b) => a - b),
      orderbookCount: entry.orderbookCount,
      offers: entry.offers.slice(0, 4),
      offerCount: entry.offerCount,
      totalLiquidity: entry.totalLiquidity,
      bestOffer,
      floorPrice: null,
      meTopBid: null,
      floorDiff: null,
      floorDiffPercent: null,
      topBidDiff: null,
      topBidDiffPercent: null,
    };
  });

  if (!DUMP_LIST_ACCOUNTS) {
    const uniqueCollections = [...new Set(collections.map(c => c.collectionName))];
    for (const collName of uniqueCollections) {
      const stats = await fetchCollectionStats(collName);
      if (!stats) continue;
      for (const item of collections) {
        if (item.collectionName === collName) {
          item.floorPrice = stats.floorPrice;
          item.meTopBid = stats.topBid;
          if (item.floorPrice && item.bestOffer) {
            item.floorDiff = item.floorPrice - item.bestOffer;
            item.floorDiffPercent = (item.floorDiff / item.floorPrice) * 100;
          }
          if (item.meTopBid && item.bestOffer) {
            item.topBidDiff = item.meTopBid - item.bestOffer;
            item.topBidDiffPercent = (item.topBidDiff / item.meTopBid) * 100;
          }
        }
      }
    }
  }

  collections.sort((a, b) => {
    if (b.totalLiquidity !== a.totalLiquidity) {
      return b.totalLiquidity - a.totalLiquidity;
    }
    return a.collectionName.localeCompare(b.collectionName);
  });
  if (DUMP_LIST_ACCOUNTS) {
    let dumpCollections = collections.filter(c => c.totalLiquidity > DUMP_MIN_LIQUIDITY);
    dumpCollections.sort((a, b) => b.totalLiquidity - a.totalLiquidity);
    if (Number.isFinite(DUMP_TOP) && DUMP_TOP > 0) {
      dumpCollections = dumpCollections.slice(0, DUMP_TOP);
    }
    console.log(`Found ${dumpCollections.length} entries (min liquidity ${DUMP_MIN_LIQUIDITY} SOL)\n`);
    for (const item of dumpCollections) {
      const typeLabel = item.collectionType || 'unknown';
      const idLabel = item.collectionId || 'unknown';
      console.log(`${typeLabel}: ${idLabel}`);
      if (item.collectionName && item.collectionName !== idLabel) {
        console.log(`  Name: ${item.collectionName}`);
      }
      if (item.durations && item.durations.length > 0) {
        console.log(`  Durations: ${item.durations.join('d, ')}d`);
      }
      console.log(`  Best offer: ${formatSol(item.bestOffer)}`);
      console.log(`  Offers: ${item.offerCount} | Orderbooks: ${item.orderbookCount || 0}`);
      console.log(`  Liquidity: ${item.totalLiquidity.toFixed(2)} SOL`);
      console.log('');
    }
    return;
  }

  console.log(`Found ${collections.length} collections\n`);

  for (const item of collections) {
    console.log(`Collection: ${item.collectionName}`);
    console.log(`  Best offer: ${formatSol(item.bestOffer)}`);
    console.log(`  ME instant sell: ${formatSol(item.meTopBid)}`);
    console.log(`  Floor: ${formatSol(item.floorPrice)}`);
    console.log(`  Delta Floor - Sharky: ${formatDelta(item.floorDiff, item.floorDiffPercent)}`);
    console.log(`  Delta ME Bid - Sharky: ${formatDelta(item.topBidDiff, item.topBidDiffPercent)}`);
    console.log(`  Offers: ${item.offerCount} | Liquidity: ${item.totalLiquidity.toFixed(2)} SOL`);
    console.log('');
  }
}

main().catch(console.error);
