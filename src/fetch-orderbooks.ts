import { createSharkyClient, createProvider } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COLLECTIONS_PATH = path.join(__dirname, '..', 'config', 'collections.json');
const ORDERBOOKS_PATH = path.join(__dirname, '..', 'config', 'orderbooks.json');

interface OrderBookConfig {
  pubkey: string;
  collectionName: string;
  apr: number;
  durationDays: number | null;
  feePercent: number;
}

async function main() {
  // Загружаем whitelist коллекций
  if (!fs.existsSync(COLLECTIONS_PATH)) {
    console.error(`Collections config not found: ${COLLECTIONS_PATH}`);
    process.exit(1);
  }
  
  const collections: string[] = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf-8'));
  const collectionsSet = new Set(collections.map(c => c.toLowerCase()));
  
  console.log(`Loaded ${collections.length} collections from whitelist`);

  const wallet = Keypair.generate();
  const connection = new Connection(RPC_URL, 'confirmed');
  
  const provider = createProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
  });

  const sharky = createSharkyClient(provider, undefined, 'mainnet');

  console.log('Fetching orderbooks...');

  const [orderBooks, nftLists] = await Promise.all([
    sharky.fetchAllOrderBooks({ program: sharky.program }),
    sharky.fetchAllNftLists({ program: sharky.program }),
  ]);

  const nftListMap = new Map(nftLists.map(list => [list.pubKey.toBase58(), list.collectionName]));

  const config: OrderBookConfig[] = [];

  for (const orderBook of orderBooks) {
    let collectionName = '';
    
    if (orderBook.orderBookType.nftList) {
      collectionName = nftListMap.get(orderBook.orderBookType.nftList.listAccount.toBase58()) || '';
    }

    // Фильтруем по whitelist (case-insensitive)
    if (!collectionName || !collectionsSet.has(collectionName.toLowerCase())) {
      continue;
    }

    const apr = orderBook.apy.fixed?.apy ? orderBook.apy.fixed.apy / 1000 : 0;
    const durationSeconds = orderBook.loanTerms.fixed?.terms.time?.duration?.toNumber();
    const durationDays = durationSeconds ? durationSeconds / (24 * 60 * 60) : null;

    config.push({
      pubkey: orderBook.pubKey.toBase58(),
      collectionName,
      apr,
      durationDays,
      feePercent: orderBook.feePermillicentage / 1000,
    });
  }

  // Сортируем по имени коллекции, потом по APR
  config.sort((a, b) => {
    const nameCompare = a.collectionName.localeCompare(b.collectionName);
    if (nameCompare !== 0) return nameCompare;
    return b.apr - a.apr; // Выше APR первым
  });

  fs.writeFileSync(ORDERBOOKS_PATH, JSON.stringify(config, null, 2));

  console.log(`Found ${config.length} orderbooks for ${collections.length} collections`);
  
  // Выводим статистику по коллекциям
  const byCollection = new Map<string, number>();
  config.forEach(ob => {
    byCollection.set(ob.collectionName, (byCollection.get(ob.collectionName) || 0) + 1);
  });
  
  console.log('\nOrderbooks per collection:');
  for (const [name, count] of byCollection) {
    console.log(`  ${name}: ${count}`);
  }
  
  // Показываем коллекции из whitelist которые не найдены
  const foundCollections = new Set(config.map(c => c.collectionName.toLowerCase()));
  const notFound = collections.filter(c => !foundCollections.has(c.toLowerCase()));
  if (notFound.length > 0) {
    console.log('\nCollections not found:');
    notFound.forEach(c => console.log(`  - ${c}`));
  }
}

main().catch(console.error);
