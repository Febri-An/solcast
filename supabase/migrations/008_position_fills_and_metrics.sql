-- Per-trade ledger + derived per-position cost basis for realtime PnL.
-- `positions_cache.account_data_base64` remains a raw on-chain mirror.

create table if not exists public.position_fills (
  id bigint generated always as identity primary key,
  client_fill_id text not null unique,
  tx_signature text,
  instruction_index integer not null default 0,
  wallet text not null,
  market_address text not null,
  side text not null check (side in ('buy_yes', 'buy_no', 'sell_yes', 'sell_no')),
  shares_delta numeric(39, 0) not null,
  lamports_delta numeric(39, 0) not null,
  fee_lamports numeric(39, 0) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists position_fills_wallet_market_created_at
  on public.position_fills (wallet, market_address, created_at desc);

create table if not exists public.position_metrics (
  wallet text not null,
  market_address text not null,
  yes_open_shares numeric(39, 0) not null default 0,
  no_open_shares numeric(39, 0) not null default 0,
  yes_cost_basis_lamports numeric(39, 0) not null default 0,
  no_cost_basis_lamports numeric(39, 0) not null default 0,
  realized_pnl_lamports numeric(39, 0) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wallet, market_address)
);

create index if not exists position_metrics_updated_at
  on public.position_metrics (updated_at desc);

alter table public.position_fills enable row level security;
alter table public.position_metrics enable row level security;

create policy "position_fills_no_anon"
  on public.position_fills
  for all
  to anon
  using (false)
  with check (false);

create policy "position_fills_no_authenticated"
  on public.position_fills
  for all
  to authenticated
  using (false)
  with check (false);

create policy "position_metrics_no_anon"
  on public.position_metrics
  for all
  to anon
  using (false)
  with check (false);

create policy "position_metrics_no_authenticated"
  on public.position_metrics
  for all
  to authenticated
  using (false)
  with check (false);
