"use client";

import { useProbabilityFlash } from "../hooks/use-probability-flash";

export type ProbabilityVariant = "yes" | "no" | "neutral";

/** Stable display: fixes float drift from `yesBps / 100` etc. */
export function formatProbabilityPercentDisplay(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2);
}

export interface ProbabilityPercentProps {
  value: number;
  variant: ProbabilityVariant;
  /** Extra classes (size, weight, etc.). Flash colors merge via transition-colors. */
  className?: string;
}

export function ProbabilityPercent({
  value,
  variant,
  className = "",
}: ProbabilityPercentProps) {
  const flash = useProbabilityFlash(value);

  const baseClass =
    variant === "yes"
      ? "text-green-text"
      : variant === "no"
        ? "text-red-text"
        : "text-foreground";

  const colorClass =
    flash === "up" ? "text-green-400" : flash === "down" ? "text-red-400" : baseClass;

  return (
    <span className={`transition-colors duration-700 ${colorClass} ${className}`.trim()}>
      {formatProbabilityPercentDisplay(value)}%
    </span>
  );
}
