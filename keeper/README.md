# Prediction Market Keeper Bot

A standalone Node.js worker that auto-resolves expired markets using Pyth price
updates. Resolve is **permissionless** on-chain — the keeper is simply the
off-chain actor that pays the transaction fee and submits the Pyth update.

## How it works

Every `KEEPER_POLL_INTERVAL_MS` (default 15s) the bot:

1. Scans all `Market` accounts owned by the program (`getProgramAccounts` +
   Codama decoder).
2. Filters to markets that are:
   - not yet `resolved`
   - past `resolution_time`
   - still within the **30-minute grace period** (on-chain guard)
   - past a small wait (`+30s`) so Hermes has a price near the deadline
   - have at least `KEEPER_MIN_LIQUIDITY_SOL` total pool (anti-spam)
3. For each eligible market:
   - Fetches the Pyth price update **at `resolution_time`** from Hermes
     (`getPriceUpdatesAtTimestamp`).
   - Posts it on-chain via the Pyth Receiver program.
   - Invokes `resolve_market` — outcome is computed on-chain by comparing
     the Pyth price against the market's `target_price`.

The on-chain program enforces a `±30s` tolerance between Pyth's `publish_time`
and the market's `resolution_time`, so late resolves cannot bias the outcome
with more recent prices.

### Embedded cache sync

The same process also refreshes Supabase `markets_cache` / `positions_cache`
on an independent interval (default **60s**). This keeps the frontend DB in
sync with chain state without needing a separate cron runner while you're in
local dev. It activates automatically if `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set in the project-root `.env`.

Turn it off with `KEEPER_CACHE_SYNC_DISABLED=true` once you deploy a real
cron (Vercel Cron, GitHub Actions, `pg_cron`, etc. — see `docs/CRON.md`).

## Setup

```bash
# from project root
cp keeper/.env.example keeper/.env
# edit keeper/.env with your RPC URL and keypair path
```

Make sure the keeper wallet is funded with a small amount of SOL (each resolve
costs ~0.00001–0.0005 SOL depending on priority fee).

## Run locally

```bash
# dry-run: log eligible markets without sending any tx
npm run keeper:dry

# verbose dry-run: also log why each market was skipped
npx tsx keeper/src/index.ts --dry-run --verbose

# run for real (Ctrl+C to stop)
npm run keeper:start
```

## Run on a VPS with pm2

```bash
# one-time
npm install -g pm2

# start and persist across reboots
pm2 start "npm run keeper:start" --name prediction-market-keeper
pm2 save
pm2 startup   # follow the printed instructions

# view logs / status
pm2 logs prediction-market-keeper
pm2 status

# stop / restart
pm2 restart prediction-market-keeper
pm2 stop prediction-market-keeper
```

For production, do not use the devnet RPC endpoint. Use a paid endpoint
(Helius, Triton, QuickNode) to avoid rate limits.

## Configuration

See `.env.example` for all variables. Common tweaks:

| Variable                      | Default   | Purpose                                      |
| ----------------------------- | --------- | -------------------------------------------- |
| `KEEPER_RPC_URL`              | devnet    | Solana RPC endpoint                          |
| `KEEPER_KEYPAIR_PATH`         | `~/.config/solana/id.json` | Wallet used to pay resolve fees |
| `KEEPER_MIN_LIQUIDITY_SOL`    | `0.01`    | Skip markets with lower pool (anti-spam)     |
| `KEEPER_POLL_INTERVAL_MS`     | `15000`   | How often to scan                            |
| `KEEPER_MAX_MARKETS_PER_CYCLE`| `5`       | Throttle per cycle                           |
| `KEEPER_CACHE_SYNC_INTERVAL_MS` | `60000` | How often to refresh Supabase cache          |
| `KEEPER_CACHE_SYNC_DISABLED`  | `false`   | Force cache sync off                         |

## Safety notes

- The bot only submits `resolve_market`; it cannot steal funds or bet. The
  worst it can do is crash — the program's grace-period + price-timestamp
  guards prevent stale or retroactive resolves.
- If the grace period closes without any resolve, the market becomes
  permanently stuck (by design — admin unlock is out-of-scope for MVP).
  Monitor `pm2 logs` for `[closed]` / `[pyth]` warnings.
- Race with another resolver is safe: if someone else lands first, we get
  `AlreadyResolved` and move on.

## File layout

```
keeper/
  .env.example
  README.md
  postinstall.mjs  # drops .js shims for jito-ts's nested rpc-websockets (see below)
  src/
    config.ts      # env parsing
    wallet.ts      # keypair → Anchor Wallet
    markets.ts     # getProgramAccounts + Codama decoder
    cache-sync.ts  # Supabase markets/positions cache refresh (shared with /api/markets/sync)
    index.ts       # main loop
```

The resolve logic itself (Hermes fetch + Pyth Receiver + resolve ix) is shared
with the frontend via `app/lib/pyth.ts` — single source of truth.

## Why `keeper/postinstall.mjs` exists

`@pythnetwork/pyth-solana-receiver` → `@pythnetwork/solana-utils` → `jito-ts`
ships a nested `rpc-websockets@7` whose `dist/lib/*` files use the `.cjs`
extension. Node's default CJS resolver does not auto-discover `.cjs`, so the
legacy `require('rpc-websockets/dist/lib/client')` fails under plain Node/tsx.
Next.js sidesteps this via `next.config.ts`'s `resolveAlias`. For the keeper
we drop thin `.js` shims (`client.js` → `require('./client.cjs')`) during
`postinstall`. Safe to delete — `npm install` will recreate them.
