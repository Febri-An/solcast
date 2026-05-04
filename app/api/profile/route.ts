import { type NextRequest, NextResponse } from "next/server";

import {
  isValidUsername,
  parseProfileChallengeMessage,
  verifyWalletMessageSignature,
} from "../../lib/profile-challenge";
import { createAnonSupabase, createServiceSupabase, isSupabaseConfigured } from "../../lib/supabase/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ profile: null, configured: false });
  }

  const supabase = createAnonSupabase();
  if (!supabase) {
    return NextResponse.json({ profile: null, configured: false });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("wallet_address, username, avatar_url, updated_at")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (error) {
    console.error("profile fetch error:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }

  return NextResponse.json({
    profile: data,
    configured: true,
  });
}

interface PostBody {
  wallet?: string;
  message?: string;
  signature?: string;
  username?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const wallet = body.wallet?.trim();
  const message = body.message?.trim();
  const signature = body.signature?.trim();
  const username = body.username?.trim() ?? "";

  if (!wallet || !message || !signature) {
    return NextResponse.json({ error: "wallet, message, and signature are required" }, { status: 400 });
  }

  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 3–32 characters (letters, numbers, underscore)" },
      { status: 400 },
    );
  }

  const parsed = parseProfileChallengeMessage(message);
  if (!parsed || parsed.wallet !== wallet) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }

  if (Date.now() > parsed.expiresAt) {
    return NextResponse.json({ error: "Challenge expired; request a new one" }, { status: 400 });
  }

  const ok = await verifyWalletMessageSignature(wallet, message, signature);
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          wallet_address: wallet,
          username,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" },
      )
      .select("wallet_address, username, avatar_url, updated_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
      }
      console.error("profile upsert error:", error);
      return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}
