# SolCast

A full-stack **AMM-based** prediction market on Solana using Anchor + framework-kit.
Admin creates price-prediction markets seeded with liquidity; users trade YES / NO
shares against a Polymarket-style CPMM pool and redeem winning shares 1:1 after
Pyth-oracle resolution.

## Getting Started

```shell
npm install
npm run setup   # Builds program and generates client
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect your wallet, and interact with prediction markets on devnet.

## Features

- **Admin-only market creation** — a hard-coded admin wallet seeds initial AMM
  liquidity and sets the target price for a Pyth feed
- **CPMM pricing** — YES / NO shares trade against a constant-product pool
  (`k = yes_shares * no_shares`), giving continuous price discovery and exit
  liquidity at any time before resolution
- **Buy / sell with slippage guards** — every trade carries a 1% default
  slippage tolerance enforced on-chain
- **Permissionless resolution via Pyth** — anyone can trigger resolve in a
  30-minute grace window; oracle price must be within 30 s of the deadline
- **Auto-resolving keeper** — watches devnet for eligible markets and
  resolves them with fresh Pyth prices; embeds a Supabase cache sync so the
  frontend has near-real-time data without hammering RPC

## Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| Frontend       | Next.js 16, React 19, TypeScript        |
| Styling        | Tailwind CSS v4                         |
| Solana Client  | `@solana/client`, `@solana/react-hooks` |
| Program Client | Codama-generated, `@solana/kit`         |
| Program        | Anchor 0.31 (Rust)                      |

## Project Structure

```
├── app/
│   ├── components/
│   │   ├── providers.tsx           # Solana client setup
│   │   ├── create-market-form.tsx  # Market creation UI
│   │   ├── market-card.tsx         # Market betting/resolution UI
│   │   └── markets-list.tsx        # Fetch and display all markets
│   ├── generated/prediction_market/ # Codama-generated client
│   └── page.tsx                    # Main page
├── anchor/
│   └── programs/prediction_market/ # Prediction market program (Rust)
└── codama.json                     # Codama client generation config
```

## How It Works

### Program Architecture

**Accounts:**
- `Market` (PDA) — question, Pyth feed + target, CPMM state
  (`yes_shares`, `no_shares`, `fee_bps`, `initial_liquidity`),
  outstanding-share bookkeeping, resolution + outcome
- `UserPosition` (PDA) — per-(market, user) share balances
  (`yes_shares`, `no_shares`). Redeem simply zeroes the winning side.

**Instructions:**
1. `create_market(market_id, question, resolution_time, feed_id,
   target_price, initial_liquidity, fee_bps)` — admin-only. Transfers
   `initial_liquidity` lamports into the market PDA and seeds the pool
   at `(L, L)`.
2. `buy(amount_in, buy_yes, min_shares_out)` — mint `D_net = amount_in * (1 − fee)`
   YES + NO, swap one side inside the pool, hand back YES/NO shares to the user.
3. `sell(shares_in, sell_yes, min_sol_out)` — user returns shares to the
   pool; program burns a matching YES+NO pair and pays lamports out of the
   treasury. Integer-sqrt Babylonian solves the quadratic that keeps
   `k = yes_shares * no_shares` invariant.
4. `resolve_market` — permissionless after the deadline. Compares Pyth price
   against `target_price`; requires the price publish time to be within
   30 s of the deadline and resolve to happen within a 30-minute grace window.
5. `redeem` — user's winning-side shares are paid at 1 lamport each.
6. `withdraw_liquidity` — admin-only, post-resolve. Pays out the pool's
   winning-side share plus accumulated fees, while leaving enough lamports
   in the treasury for all outstanding user redemptions.

**Core math (Gnosis FPMM):**

```
buy  YES: shares_out = D_net · (yes + no + D_net) / (no + D_net)
          new_yes   = yes · no / (no + D_net)
          new_no    = no + D_net

sell YES: solve X² − X·(yes + no + Δ) + Δ·no = 0
          X        = (B − √(B² − 4·Δ·no)) / 2
          new_yes  = yes + Δ − X
          new_no   = no − X
```

### Security

- PDA-owned treasury; no off-program custody
- Admin-gated `create_market` + `withdraw_liquidity` (`require_keys_eq!`)
- Time-based trading window + resolve grace period + Pyth publish-time
  tolerance enforced on-chain
- Slippage guards on every swap (`min_shares_out`, `min_sol_out`)
- Withdraw leaves `user_outstanding` lamports reserved so winners can
  always redeem
- All share / lamport arithmetic is `checked_*` with explicit `u128`
  intermediates for the AMM math

## Deploy Your Own

### Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://solana.com/docs/intro/installation)
- [Anchor](https://www.anchor-lang.com/docs/installation)

### Steps

1. **Configure Solana CLI for devnet**
   ```bash
   solana config set --url devnet
   ```

2. **Create a wallet and fund it**
   ```bash
   solana-keygen new
   solana airdrop 2
   ```

3. **Build and deploy**
   ```bash
   cd anchor
   anchor build
   anchor keys sync    # Updates program ID in source
   anchor build        # Rebuild with new ID
   anchor deploy
   cd ..
   npm run setup       # Regenerate client
   npm run dev
   ```

## Testing

The program includes LiteSVM-based tests in `anchor/programs/prediction_market/src/tests.rs`.

```bash
npm run anchor-build   # Build first
npm run anchor-test    # Run tests
```

## Learn More

- [Solana Docs](https://solana.com/docs) - core concepts
- [Anchor Docs](https://www.anchor-lang.com/docs) - program framework
- [framework-kit](https://github.com/solana-foundation/framework-kit) - React hooks
- [Codama](https://github.com/codama-idl/codama) - client generation
- [solana-dev-skill](https://github.com/GuiBibeau/solana-dev-skill) - Claude Code skill for Solana development
