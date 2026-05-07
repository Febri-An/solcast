-- Gross lamports on the market PDA (collateral vault + rent). Not the same as
-- yes_shares + no_shares (CPMM pool reserves are not additive SOL liquidity).
alter table public.markets_cache
  add column if not exists vault_lamports bigint;

comment on column public.markets_cache.vault_lamports is
  'Market account lamports from getAccountInfo (includes rent exemption).';
