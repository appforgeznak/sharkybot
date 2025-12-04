import { createSharkyClient, createProvider } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function main() {
  // Загружаем кошелек
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
    // Для read-only операций можно использовать случайный keypair
    wallet = Keypair.generate();
    console.log('No wallet found, using dummy keypair for read-only operations');
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Создаём provider с wallet interface
  const provider = createProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) {
        tx.partialSign(wallet);
      }
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      txs.forEach(tx => {
        if (tx instanceof Transaction) {
          tx.partialSign(wallet);
        }
      });
      return txs;
    },
  });

  const sharky = createSharkyClient(provider, undefined, 'mainnet');

  console.log('\nFetching orderbooks...\n');

  // Получаем все orderbooks и nftLists параллельно
  const [orderBooks, nftLists] = await Promise.all([
    sharky.fetchAllOrderBooks({ program: sharky.program }),
    sharky.fetchAllNftLists({ program: sharky.program }),
  ]);

  // Создаём map для быстрого поиска имени коллекции по pubkey
  const nftListMap = new Map(nftLists.map(list => [list.pubKey.toBase58(), list.collectionName]));

  console.log(`Found ${orderBooks.length} orderbooks:\n`);

  // Выводим информацию о каждом orderbook
  for (const orderBook of orderBooks.slice(0, 50)) {
    const apr = orderBook.apy.fixed?.apy ? orderBook.apy.fixed.apy / 1000 : 0;
    
    // Получаем имя коллекции
    let collectionName = 'Unknown';
    if (orderBook.orderBookType.nftList) {
      collectionName = nftListMap.get(orderBook.orderBookType.nftList.listAccount.toBase58()) || 'Unknown';
    } else if (orderBook.orderBookType.collection) {
      collectionName = `Collection: ${orderBook.orderBookType.collection.collectionKey.toBase58().slice(0, 8)}...`;
    }

    // Получаем duration из loanTerms
    const durationSeconds = orderBook.loanTerms.fixed?.terms.time?.duration?.toNumber();
    const durationDays = durationSeconds ? durationSeconds / (24 * 60 * 60) : null;
    
    console.log(`Collection: ${collectionName}`);
    console.log(`  Pubkey: ${orderBook.pubKey.toBase58()}`);
    console.log(`  APR: ${apr.toFixed(2)}%`);
    console.log(`  Duration: ${durationDays !== null ? `${durationDays} days` : 'N/A'}`);
    console.log(`  Fee: ${orderBook.feePermillicentage / 1000}%`);
    console.log('');
  }

  if (orderBooks.length > 50) {
    console.log(`... and ${orderBooks.length - 50} more orderbooks`);
  }
}

main().catch(console.error);
