import { randomBytes } from "node:crypto";

import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";

import { buildProfileChallengeMessage } from "../../../lib/profile-challenge";
import { isSupabaseConfigured } from "../../../lib/supabase/server";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet query parameter" }, { status: 400 });
  }

  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = buildProfileChallengeMessage(wallet, nonce, expiresAt);

  return NextResponse.json({ message, nonce, expiresAt });
}
