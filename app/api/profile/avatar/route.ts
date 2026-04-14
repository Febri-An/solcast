import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { parseProfileChallengeMessage, verifyWalletMessageSignature } from "../../../lib/profile-challenge";
import { createServiceSupabase, isSupabaseConfigured } from "../../../lib/supabase/server";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const wallet = (form.get("wallet") as string | null)?.trim();
  const message = (form.get("message") as string | null)?.trim();
  const signature = (form.get("signature") as string | null)?.trim();
  const file = form.get("file");

  if (!wallet || !message || !signature) {
    return NextResponse.json({ error: "wallet, message, and signature are required" }, { status: 400 });
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
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

  const type = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, or WebP images are allowed" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 2MB or smaller" }, { status: 400 });
  }

  const objectPath = `${wallet}/${randomUUID()}.${extFromMime(type)}`;

  try {
    const supabase = createServiceSupabase();
    const { error: uploadError } = await supabase.storage.from("avatars").upload(objectPath, buf, {
      contentType: type,
      upsert: true,
    });

    if (uploadError) {
      console.error("avatar upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(objectPath);

    const { data, error: updateError } = await supabase
      .from("profiles")
      .upsert(
        {
          wallet_address: wallet,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" },
      )
      .select("wallet_address, username, avatar_url, updated_at")
      .single();

    if (updateError) {
      console.error("profile avatar update error:", updateError);
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
  }
}
