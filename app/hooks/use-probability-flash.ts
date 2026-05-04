"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 800;

/** Two-decimal comparison — matches bps-derived `yesPercent` / `noPercent` steps. */
function sameDisplayPercent(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * When `value` moves in a meaningful step, yields `"up"` / `"down"` for ~800ms
 * so the UI can flash highlight (realtime ticks, optimistic overlay, etc.).
 */
export function useProbabilityFlash(value: number): "up" | "down" | null {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === null) {
      prevRef.current = value;
      return;
    }
    if (sameDisplayPercent(value, prev)) {
      prevRef.current = value;
      return;
    }
    const direction: "up" | "down" = value > prev ? "up" : "down";
    prevRef.current = value;
    setFlash(direction);
    const id = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [value]);

  return flash;
}
