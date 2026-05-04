"use client";

import { useEffect, useMemo, useState } from "react";

import { formatResolutionCountdownRemaining } from "../lib/market-format";

/** Visual urgency for styling only (betting still open). */
export type ResolutionCountdownUrgency = "normal" | "soon" | "critical" | "ended";

const ONE_HOUR_SEC = 3600;
const FIVE_MIN_SEC = 300;

export function resolutionCountdownTextClassName(
  urgency: ResolutionCountdownUrgency,
): string {
  switch (urgency) {
    case "critical":
      return "font-mono font-semibold tabular-nums text-red-text animate-countdown-critical";
    case "soon":
      return "font-mono font-semibold tabular-nums text-amber";
    case "ended":
      return "font-mono tabular-nums text-muted";
    default:
      return "font-mono tabular-nums text-foreground-secondary";
  }
}

/**
 * Live countdown to `resolutionTimeSec` (Unix seconds). When `active` is false,
 * no interval runs; label reflects a single fresh read (for static rows).
 */
export function useResolutionCountdown(
  resolutionTimeSec: number,
  active: boolean,
): {
  label: string;
  remainingSec: number;
  urgency: ResolutionCountdownUrgency;
} {
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);

  useEffect(() => {
    setNowSec(Date.now() / 1000);
  }, [active, resolutionTimeSec]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [active]);

  return useMemo(() => {
    const remainingSec = Math.max(0, resolutionTimeSec - nowSec);
    const label = formatResolutionCountdownRemaining(resolutionTimeSec - nowSec);

    if (!active) {
      const urgency: ResolutionCountdownUrgency =
        remainingSec <= 0 ? "ended" : "normal";
      return { label, remainingSec, urgency };
    }

    if (remainingSec <= 0) {
      return {
        label: "Ended",
        remainingSec: 0,
        urgency: "ended",
      };
    }

    let urgency: ResolutionCountdownUrgency = "normal";
    if (remainingSec < FIVE_MIN_SEC) urgency = "critical";
    else if (remainingSec < ONE_HOUR_SEC) urgency = "soon";

    return { label, remainingSec, urgency };
  }, [active, resolutionTimeSec, nowSec]);
}
