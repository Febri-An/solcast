/**
 * Solana JSON-RPC endpoint for the app (browser + server components).
 * Set NEXT_PUBLIC_SOLANA_RPC_URL in .env (see .env.example).
 */
export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
