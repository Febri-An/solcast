import { Connection } from "@solana/web3.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `useSendTransaction().send` resolves to a base58 signature string in practice. */
export function signatureToBase58(sig: unknown): string {
  if (typeof sig === "string" && sig.length > 0) return sig;
  if (sig != null && typeof sig === "object" && "toString" in sig) {
    const s = String((sig as { toString: () => string }).toString());
    if (s && !s.startsWith("[object ")) return s;
  }
  throw new Error("Missing or invalid transaction signature from wallet send()");
}

/**
 * After `useSendTransaction().send()` resolves, double-check the signature
 * actually succeeded on-chain. Some wallet/RPC paths can resolve before an
 * error surface is visible to the caller; this avoids false "success" toasts.
 */
export async function assertSignatureSucceeded(
  connection: Connection,
  signature: string,
  options?: { maxWaitMs?: number },
): Promise<void> {
  const maxWaitMs = options?.maxWaitMs ?? 25_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = value[0];
    if (st?.err) {
      throw new Error(
        `Transaction ${signature.slice(0, 8)}… failed on-chain: ${JSON.stringify(st.err)}`,
      );
    }
    if (
      st &&
      (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")
    ) {
      return;
    }
    await sleep(400);
  }

  throw new Error(
    `Could not confirm transaction ${signature.slice(0, 8)}… (timeout). Check explorer or retry.`,
  );
}
