import { NextResponse } from "next/server";

import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet")?.trim();
  const market = searchParams.get("market")?.trim();

  if (!wallet || !market) {
    return NextResponse.json({ error: "wallet and market are required" }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 503 },
    );
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("position_metrics")
      .select(
        "wallet, market_address, yes_open_shares, no_open_shares, yes_cost_basis_lamports, no_cost_basis_lamports, realized_pnl_lamports, updated_at",
      )
      .eq("wallet", wallet)
      .eq("market_address", market)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, metrics: data ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
