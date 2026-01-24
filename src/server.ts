import express from 'express';
import { collectionNameByOrderBookPubKey, createSharkyClient, createProvider, OfferedLoan } from '@sharkyfi/client';
import { Connection, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COLLECTIONS_PATH = path.join(__dirname, '..', 'config', 'collections.json');
const UPDATE_INTERVAL = 60_000; // 1 Р В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°
const ME_API_BASE = 'https://api-mainnet.magiceden.dev/v2';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 60000);

// Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚Сљ Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В° Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњ Magic Eden
const COLLECTION_SYMBOLS: Record<string, string> = {
  'DeGods': 'degods',
  'Mad Lads': 'mad_lads',
  'Tensorians': 'tensorians',
  'Famous Fox Federation': 'famous_fox_federation',
  'Claynosaurz': 'claynosaurz',
};

interface CollectionStats {
  floorPrice: number | null; // Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В  SOL
  topBid: number | null; // Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В  SOL (Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎв„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ bid Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В° ME)
  listedCount: number;
  avgPrice24hr: number | null;
  volumeAll: number | null;
}

interface CollectionData {
  collectionName: string;
  offers: OfferData[];
  offerCount: number;
  totalLiquidity: number; // in SOL
  bestOffer: number | null; // best offer per collection (SOL)
  floorPrice: number | null; // in SOL
  meTopBid: number | null; // ME instant-sell top bid (SOL)
  floorDiff: number | null;
  floorDiffPercent: number | null;
  topBidDiff: number | null;
  topBidDiffPercent: number | null;
}

interface CollectionConfig {
  name: string;
  listAccount?: string;
  collectionKey?: string;
}

interface OfferData {
  pubkey: string;
  principalSol: number;
  lender: string;
  diffFromTop: number | null; // Р В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В° Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћ top offer Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В  SOL
  diffFromTopPercent: number | null; // Р В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В° Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћ top offer Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В  %
}

let orderbooks: CollectionData[] = [];
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
    // Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРЎСџР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В stats Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В MMM pools Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›
    const [statsRes, poolsRes] = await Promise.all([
      fetch(`${ME_API_BASE}/collections/${symbol}/stats`),
      fetch(`${ME_API_BASE}/mmm/pools?collectionSymbol=${symbol}&limit=50`),
    ]);

    const statsData = statsRes.ok ? await statsRes.json() as MEStatsResponse : null;
    const poolsData = poolsRes.ok ? await poolsRes.json() as MEPoolResponse : null;

    // Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎв„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ bid Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В· pools
    // ME Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В±Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р вЂ™Р’ВР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћ ~2% Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРІвЂћвЂ“ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В instant sell
    const ME_FEE = 0.02;
    let topBid: number | null = null;
    if (poolsData?.results) {
      const now = Math.floor(Date.now() / 1000);
      const activeBids = poolsData.results
        .filter(p => 
          (p.poolType === 'buy_sided' || p.poolType === 'two_sided') && 
          p.buysidePaymentAmount > 0 &&
          (p.expiry === 0 || p.expiry > now) && // Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’Вµ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦
          p.buysidePaymentAmount >= p.spotPrice // Р В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В  Р В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В Р РЏ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В
        )
        .map(p => (p.spotPrice / LAMPORTS_PER_SOL) * (1 - ME_FEE)); // net price Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’Вµ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В
      
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

async function fetchOrderbooks() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    console.log('[' + new Date().toISOString() + '] Fetching orderbooks and offers...');

    const wallet = Keypair.generate();
    const connection = new Connection(RPC_URL, 'confirmed');

    const provider = createProvider(connection, {
      publicKey: wallet.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
    });

    const sharky = createSharkyClient(provider, undefined, 'mainnet');
    const whitelist = loadCollectionsWhitelist();

    // Load orderbooks
    const allOrderBooks = await withTimeout(
      sharky.fetchAllOrderBooks({ program: sharky.program }),
      'fetchAllOrderBooks'
    );

// Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В±Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎв„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р’В Р В Р РЏ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В° Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚Сљ loans
    await new Promise(resolve => setTimeout(resolve, 2000));

    let allLoans: Awaited<ReturnType<typeof sharky.fetchAllLoans>> = [];
    try {
      allLoans = await withTimeout(sharky.fetchAllLoans({ program: sharky.program }), 'fetchAllLoans');
    } catch (err) {
      console.warn('Failed to fetch loans (rate limit?), continuing without offers');
    }

    const { enforceWhitelist, listAccountSet, collectionKeySet, listAccountToName, collectionKeyToName, nameRules } = whitelist;
    console.log(`[${new Date().toISOString()}] Orderbooks: ${allOrderBooks.length}`);

    // Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В¤Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› offered loans (Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’Вµ taken)
    const offeredLoans = allLoans.filter((loan): loan is OfferedLoan => loan.state === 'offered');
    console.log(`[${new Date().toISOString()}] Offered loans: ${offeredLoans.length}`);
    
    // Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В offers Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› orderbook
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
      offers: OfferData[];
      offerCount: number;
      totalLiquidity: number;
    }>();

    for (const orderBook of allOrderBooks) {
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

      let collectionName = '';

      if (orderBook.orderBookType.nftList) {
        const listKey = orderBook.orderBookType.nftList.listAccount.toBase58();
        const listAllowed = listAccountSet.has(listKey);
        if (enforceWhitelist && !listAllowed && !matchedRule) {
          continue;
        }
        collectionName = listAccountToName.get(listKey) || matchedRule?.display || mappedName || `NFT List ${listKey.slice(0, 8)}`;
      } else if (orderBook.orderBookType.collection) {
        const collectionKey = orderBook.orderBookType.collection.collectionKey.toBase58();
        const collectionAllowed = collectionKeySet.has(collectionKey);
        if (enforceWhitelist && !collectionAllowed && !matchedRule) {
          continue;
        }
        collectionName = collectionKeyToName.get(collectionKey) || matchedRule?.display || mappedName || `Collection ${collectionKey.slice(0, 8)}`;
      } else {
        if (enforceWhitelist && !matchedRule) {
          continue;
        }
        collectionName = matchedRule?.display || mappedName;
      }

      if (!collectionName) {
        continue;
      }

      const offers = offersByOrderbook.get(orderbookKey) || [];
      offers.sort((a, b) => b.principalSol - a.principalSol);
      const topOffers = offers.slice(0, 4);
      const totalLiquidity = liquidityByOrderbook.get(orderbookKey) || 0;
      const offerCount = offerCountByOrderbook.get(orderbookKey) || 0;

      if (!collectionMap.has(collectionName)) {
        collectionMap.set(collectionName, {
          collectionName,
          offers: [],
          offerCount: 0,
          totalLiquidity: 0,
        });
      }

      const entry = collectionMap.get(collectionName)!;
      entry.offers.push(...topOffers);
      entry.offerCount += offerCount;
      entry.totalLiquidity += totalLiquidity;
    }

    let newOrderbooks: CollectionData[] = Array.from(collectionMap.values()).map(entry => {
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
    console.log(`[${new Date().toISOString()}] Collections after grouping: ${newOrderbooks.length}`);
    const uniqueCollections = [...new Set(newOrderbooks.map(ob => ob.collectionName))];
    for (const collName of uniqueCollections) {
      const stats = await fetchCollectionStats(collName);
      if (stats) {
        collectionStatsCache.set(collName, stats);
      }
    }

    // Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р В Р вЂ№Р В Р’В Р В Р РЏР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В floor price, top bid Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В Р В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р В Р вЂ№Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В
    for (const ob of newOrderbooks) {
      const stats = collectionStatsCache.get(ob.collectionName);
      if (stats) {
        ob.floorPrice = stats.floorPrice;
        ob.meTopBid = stats.topBid;
        // Deltas: floor - best offer
        if (ob.floorPrice && ob.bestOffer) {
          ob.floorDiff = ob.floorPrice - ob.bestOffer;
          ob.floorDiffPercent = (ob.floorDiff / ob.floorPrice) * 100;
        }
        // Deltas: ME top bid - best offer
        if (ob.meTopBid && ob.bestOffer) {
          ob.topBidDiff = ob.meTopBid - ob.bestOffer;
          ob.topBidDiffPercent = (ob.topBidDiff / ob.meTopBid) * 100;
        }
      }
    }

    // Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В¤Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› 7-Р В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’Вµ orderbooks

    // Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎСљР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В РЎС›Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р’В Р РЋРІР‚СљР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В (Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В±Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р В Р вЂ№Р В Р’В Р В РІР‚В°Р В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎв„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’Вµ Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р В Р вЂ№Р В Р’В Р Р†Р вЂљРЎв„ўР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В), Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС›Р В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРІР‚СњР В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљРЎС› Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’ВР В Р’В Р вЂ™Р’В Р В Р Р‹Р вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В¦Р В Р’В Р вЂ™Р’В Р В Р Р‹Р Р†Р вЂљР’В
    newOrderbooks.sort((a, b) => {
      if (b.totalLiquidity !== a.totalLiquidity) {
        return b.totalLiquidity - a.totalLiquidity;
      }
      return a.collectionName.localeCompare(b.collectionName);
    });

    orderbooks = newOrderbooks;
    lastUpdate = new Date();

    const totalOffers = newOrderbooks.reduce((sum, ob) => sum + ob.offerCount, 0);
    console.log(
      '[' + new Date().toISOString() + '] Found ' +
      orderbooks.length + ' collections with ' + totalOffers + ' offers'
    );
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
    
    .best-offer {
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
    
    .stat-value.best {
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
      <h1>Р В Р Р‹Р В РІР‚С™Р В Р Р‹Р РЋРЎСџР В РІР‚в„ўР вЂ™Р’В¦Р В Р вЂ Р Р†Р вЂљРЎв„ўР вЂ™Р’В¬ SharkyBot</h1>
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
      const totalOffers = data.orderbooks.reduce(function(sum, ob) { return sum + ob.offerCount; }, 0);
      const totalLiquidity = data.orderbooks.reduce(function(sum, ob) { return sum + ob.totalLiquidity; }, 0);
      
      summary.innerHTML = 
        '<div class="summary-item">' +
          '<span class="summary-value">' + data.orderbooks.length + '</span>' +
          '<span class="summary-label">Collections</span>' +
        '</div>' +
        '<div class="summary-item">' +
          '<span class="summary-value">' + totalOffers + '</span>' +
          '<span class="summary-label">Offers</span>' +
        '</div>' +
        '<div class="summary-item">' +
          '<span class="summary-value">' + totalLiquidity.toFixed(2) + ' SOL</span>' +
          '<span class="summary-label">Total Liquidity</span>' +
        '</div>';
      
      if (data.orderbooks.length === 0) {
        grid.innerHTML = '<div class="empty">No collections found</div>';
        return;
      }
      
      grid.innerHTML = data.orderbooks.map(function(ob) {
        var offersHtml = '';
        if (ob.offerCount === 0) {
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
        var floorDiffText = (ob.floorDiff !== null && ob.floorDiffPercent !== null)
          ? (ob.floorDiff > 0 ? '+' : '') + ob.floorDiff.toFixed(4) + ' (' + (ob.floorDiffPercent > 0 ? '+' : '') + ob.floorDiffPercent.toFixed(1) + '%)'
          : 'N/A';
        var topBidDiffText = (ob.topBidDiff !== null && ob.topBidDiffPercent !== null)
          ? (ob.topBidDiff > 0 ? '+' : '') + ob.topBidDiff.toFixed(4) + ' (' + (ob.topBidDiffPercent > 0 ? '+' : '') + ob.topBidDiffPercent.toFixed(1) + '%)'
          : 'N/A';

        return '<div class="card">' +
          '<div class="card-header">' +
            '<span class="collection-name">' + ob.collectionName + '</span>' +
            '<span class="best-offer">' + (ob.bestOffer !== null ? ob.bestOffer.toFixed(4) + ' SOL' : 'N/A') + '</span>' +
          '</div>' +
          '<div class="card-stats">' +
            '<div class="stat">' +
              '<div class="stat-value best">' + (ob.bestOffer !== null ? ob.bestOffer.toFixed(4) : 'N/A') + '</div>' +
              '<div class="stat-label">Best Offer</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value floor">' + (ob.floorPrice ? ob.floorPrice.toFixed(4) : 'N/A') + '</div>' +
              '<div class="stat-label">Floor</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-value me-bid">' + (ob.meTopBid ? ob.meTopBid.toFixed(4) : 'N/A') + '</div>' +
              '<div class="stat-label">ME Top Bid</div>' +
            '</div>' +
'</div>' +
          '<div class="metrics-row">' +
            '<div class="metric">' +
              '<div class="metric-value ' + (ob.floorDiff > 0 ? 'diff-positive' : 'diff-negative') + '">' + 
                floorDiffText + '</div>' +
              '<div class="metric-label">Floor - Sharky</div>' +
            '</div>' +
            '<div class="metric">' +
              '<div class="metric-value ' + (ob.topBidDiff > 0 ? 'diff-positive' : 'diff-negative') + '">' + 
                topBidDiffText + '</div>' +
              '<div class="metric-label">ME Bid - Sharky</div>' +
            '</div>' +
          '</div>' +
          '<div class="offers-section">' +
            '<div class="offers-title">Top Offers</div>' +
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
