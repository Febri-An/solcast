import { NextResponse } from "next/server";

import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

type FillSide = "buy_yes" | "buy_no" | "sell_yes" | "sell_no";

type Body = {
  clientFillId?: string;
  txSignature?: string;
  instructionIndex?: number;
  wallet?: string;
  market?: string;
  side?: FillSide;
  sharesDelta?: string;
  lamportsDelta?: string;
  feeLamports?: string;
};

type MetricsRow = {
  wallet: string;
  market_address: string;
  yes_open_shares: string | number;
  no_open_shares: string | number;
  yes_cost_basis_lamports: string | number;
  no_cost_basis_lamports: string | number;
  realized_pnl_lamports: string | number;
};

function parseBigIntLike(value: string | number | undefined, fallback: bigint = 0n): bigint {
  if (value === undefined || value === null) return fallback;
  try {
    return BigInt(typeof value === "number" ? Math.trunc(value) : value);
  } catch {
    return fallback;
  }
}

function asDbNumeric(v: bigint): string {
  return v.toString();
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientFillId = body.clientFillId?.trim();
  const wallet = body.wallet?.trim();
  const market = body.market?.trim();
  const side = body.side;
  const txSignature = body.txSignature?.trim() || null;
  const instructionIndex = body.instructionIndex ?? 0;
  const sharesDelta = parseBigIntLike(body.sharesDelta);
  const lamportsDelta = parseBigIntLike(body.lamportsDelta);
  const feeLamports = parseBigIntLike(body.feeLamports);

  if (!clientFillId || !wallet || !market || !side) {
    return NextResponse.json(
      { error: "clientFillId, wallet, market, and side are required" },
      { status: 400 },
    );
  }
  if (!["buy_yes", "buy_no", "sell_yes", "sell_no"].includes(side)) {
    return NextResponse.json({ error: "Invalid side" }, { status: 400 });
  }
  if (sharesDelta <= 0n) {
    return NextResponse.json({ error: "sharesDelta must be > 0" }, { status: 400 });
  }
  if (lamportsDelta < 0n) {
    return NextResponse.json({ error: "lamportsDelta must be >= 0" }, { status: 400 });
  }

  try {
    const supabase = createServiceSupabase();

    const { data: existingFill, error: existingFillErr } = await supabase
      .from("position_fills")
      .select("id")
      .eq("client_fill_id", clientFillId)
      .maybeSingle();
    if (existingFillErr) throw existingFillErr;
    if (existingFill) return NextResponse.json({ ok: true, duplicate: true });

    const { data: existing, error: selectErr } = await supabase
      .from("position_metrics")
      .select(
        "wallet, market_address, yes_open_shares, no_open_shares, yes_cost_basis_lamports, no_cost_basis_lamports, realized_pnl_lamports",
      )
      .eq("wallet", wallet)
      .eq("market_address", market)
      .maybeSingle<MetricsRow>();
    if (selectErr) throw selectErr;

    let yesOpen = parseBigIntLike(existing?.yes_open_shares, 0n);
    let noOpen = parseBigIntLike(existing?.no_open_shares, 0n);
    let yesCost = parseBigIntLike(existing?.yes_cost_basis_lamports, 0n);
    let noCost = parseBigIntLike(existing?.no_cost_basis_lamports, 0n);
    let realized = parseBigIntLike(existing?.realized_pnl_lamports, 0n);

    if (side === "buy_yes") {
      yesOpen += sharesDelta;
      yesCost += lamportsDelta;
    } else if (side === "buy_no") {
      noOpen += sharesDelta;
      noCost += lamportsDelta;
    } else if (side === "sell_yes") {
      const sold = sharesDelta > yesOpen ? yesOpen : sharesDelta;
      const costPortion = yesOpen > 0n ? (yesCost * sold) / yesOpen : 0n;
      yesOpen -= sold;
      yesCost -= costPortion;
      if (yesOpen === 0n) yesCost = 0n;
      realized += lamportsDelta - costPortion;
    } else {
      const sold = sharesDelta > noOpen ? noOpen : sharesDelta;
      const costPortion = noOpen > 0n ? (noCost * sold) / noOpen : 0n;
      noOpen -= sold;
      noCost -= costPortion;
      if (noOpen === 0n) noCost = 0n;
      realized += lamportsDelta - costPortion;
    }

    const { error: upsertErr } = await supabase.from("position_metrics").upsert(
      {
        wallet,
        market_address: market,
        yes_open_shares: asDbNumeric(yesOpen),
        no_open_shares: asDbNumeric(noOpen),
        yes_cost_basis_lamports: asDbNumeric(yesCost),
        no_cost_basis_lamports: asDbNumeric(noCost),
        realized_pnl_lamports: asDbNumeric(realized),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,market_address" },
    );
    if (upsertErr) throw upsertErr;

    const { error: fillErr } = await supabase.from("position_fills").insert({
      client_fill_id: clientFillId,
      tx_signature: txSignature,
      instruction_index: instructionIndex,
      wallet,
      market_address: market,
      side,
      shares_delta: asDbNumeric(sharesDelta),
      lamports_delta: asDbNumeric(lamportsDelta),
      fee_lamports: asDbNumeric(feeLamports),
    });
    if (fillErr) throw fillErr;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to record fill";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
