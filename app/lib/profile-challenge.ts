import { verifyAsync } from "@noble/ed25519";
import { PublicKey } from "@solana/web3.js";

const PREFIX = "prediction-market:profile:v1";

export function buildProfileChallengeMessage(
  wallet: string,
  nonce: string,
  expiresAt: number,
): string {
  return `${PREFIX}|wallet=${wallet}|nonce=${nonce}|expiresAt=${expiresAt}`;
}

export function parseProfileChallengeMessage(
  message: string,
): { wallet: string; nonce: string; expiresAt: number } | null {
  if (!message.startsWith(`${PREFIX}|`)) return null;
  const rest = message.slice(PREFIX.length + 1);
  const parts = rest.split("|");
  const map: Record<string, string> = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    map[p.slice(0, i)] = p.slice(i + 1);
  }
  if (!map.wallet || !map.nonce || map.expiresAt === undefined) return null;
  const expiresAt = parseInt(map.expiresAt, 10);
  if (Number.isNaN(expiresAt)) return null;
  return { wallet: map.wallet, nonce: map.nonce, expiresAt };
}

export async function verifyWalletMessageSignature(
  walletAddress: string,
  message: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    new PublicKey(walletAddress);
    const messageBytes = new TextEncoder().encode(message);
    const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));
    if (signature.length !== 64) return false;
    const publicKeyBytes = new PublicKey(walletAddress).toBytes();
    return verifyAsync(signature, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username.trim());
}
