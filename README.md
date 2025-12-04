# SharkyBot

Бот для работы с [SharkyFi](https://sharky.fi/) - NFT-lending протоколом на Solana.

## Требования

- Node.js 18.x (рекомендуется через nvm)
- Solana кошелёк (опционально для read-only операций)

## Установка

```bash
nvm use 18
npm install
```

## Использование

### Список orderbooks

```bash
npx ts-node src/list-orderbooks.ts
```

С указанием кошелька:
```bash
npx ts-node src/list-orderbooks.ts --wallet-path ~/.config/solana/id.json
```

С кастомным RPC:
```bash
RPC_URL=https://your-rpc.com npx ts-node src/list-orderbooks.ts
```

## Структура данных

### OrderBook
- `pubKey` - адрес orderbook'а
- `apy.fixed.apy` - APR в millipercents (делить на 1000 для получения %)
- `loanTerms.fixed.terms.time.duration` - длительность займа в секундах
- `feePermillicentage` - комиссия в millipercents (делить на 1000 для %)

### Формулы

```typescript
// APR -> APY
const apy = aprToApy(apr)

// Расчёт процентов
const interestRatio = aprToInterestRatio(apr, durationSeconds)
const interest = principal * interestRatio
```

## Ссылки

- [SharkyFi Client](https://github.com/SharkyFi/client)
- [SharkyFi Docs](https://docs.sharky.fi/)

