import type { WalletSession } from "@solana/client";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function signProfileChallenge(
  session: WalletSession,
  walletAddress: string,
): Promise<{ message: string; signature: string }> {
  if (!session.signMessage) {
    throw new Error(
      "Wallet ini tidak mendukung penandatanganan pesan. Gunakan Phantom, Solflare, atau wallet kompatibel lain.",
    );
  }
  const res = await fetch(`/api/profile/challenge?wallet=${encodeURIComponent(walletAddress)}`);
  const data = (await res.json()) as { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Gagal meminta challenge");
  }
  const message = data.message;
  if (!message) {
    throw new Error("Respons challenge tidak valid");
  }
  const messageBytes = new TextEncoder().encode(message);
  const sigBytes = await session.signMessage(messageBytes);
  return { message, signature: uint8ArrayToBase64(sigBytes) };
}
