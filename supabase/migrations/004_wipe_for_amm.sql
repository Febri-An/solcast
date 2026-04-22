-- One-shot wipe of cache rows encoded against the pre-AMM program layout.
--
-- Run this **immediately after** you deploy the new AMM program (whose
-- account structs use yesShares / noShares / feeBps / initialLiquidity /
-- liquidityWithdrawn). The keeper's embedded cache sync will re-populate
-- both tables from RPC on its next tick.
--
-- NOTE: we keep TABLE DEFINITIONS intact — only the data is dropped.

truncate table public.positions_cache;
truncate table public.markets_cache;
