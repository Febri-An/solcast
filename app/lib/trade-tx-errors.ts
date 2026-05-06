/**
 * Inspect transaction errors from prepareAndSend — custom program codes are buried in `cause`/context chains.
 */

function walkErrorCodes(err: unknown): { anchorCode?: number; messages: string[] } {
  const messages: string[] = [];
  let anchorCode: number | undefined;

  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 8) {
    if (cur instanceof Error) messages.push(cur.message);
    const ctx = (cur as { context?: unknown }).context;
    if (ctx && typeof ctx === "object") {
      const c = ctx as { code?: number; __code?: number; logs?: string[] };
      if (typeof c.code === "number") anchorCode = anchorCode ?? c.code;
      if (typeof c.__code === "number") anchorCode = anchorCode ?? c.__code;
      if (Array.isArray(c.logs))
        for (const line of c.logs)
          if (typeof line === "string") messages.push(line);
    }
    cur = (cur as { cause?: unknown }).cause;
    depth++;
  }

  try {
    messages.push(JSON.stringify(err).slice(0, 600));
  } catch {
    /* ignore */
  }

  return { anchorCode, messages };
}

/** On-chain anchor custom error SlippageExceeded = 6015 (0x177f). */
export function isProbablySlippageExceededError(err: unknown): boolean {
  const { anchorCode, messages } = walkErrorCodes(err);
  if (anchorCode === 6015) return true;
  const hay = messages.join("\n").toLowerCase();
  return (
    hay.includes("6015") ||
    hay.includes("0x177f") ||
    hay.includes("slippage") ||
    hay.includes("below the requested minimum")
  );
}
