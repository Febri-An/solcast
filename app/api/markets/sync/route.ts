import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/markets/sync
 * Full-cache refresh from chain is disabled (markets and positions).
 * Use `POST /api/markets/sync-one` and `POST /api/positions/sync-one`
 * after successful on-chain txs. Endpoint kept for auth/cron probes.
 *
 * Authorization: if `MARKETS_SYNC_SECRET` is set, require `Authorization: Bearer <secret>`.
 */
export async function POST(request: Request) {
  const secret = process.env.MARKETS_SYNC_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    markets: { skipped: true, reason: "market_full_sync_disabled" },
    positions: { skipped: true, reason: "positions_full_sync_disabled" },
  });
}
