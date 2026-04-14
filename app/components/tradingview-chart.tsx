"use client";

import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => void;
    };
  }
}

interface TradingViewChartProps {
  symbol: string;
  height?: number;
}

function loadTradingViewScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return;
    if (window.TradingView) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("TradingView script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TradingView script failed"));
    document.head.appendChild(script);
  });
}

export function TradingViewChart({ symbol, height = 480 }: TradingViewChartProps) {
  const rawId = useId().replace(/:/g, "");
  const containerId = `tv_${rawId}`;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const mountEl = containerRef.current;

    loadTradingViewScript()
      .then(() => {
        if (cancelled || !window.TradingView) return;
        const el = mountEl;
        if (!el) return;
        el.innerHTML = "";
        const inner = document.createElement("div");
        inner.id = containerId;
        inner.className = "h-full w-full";
        el.appendChild(inner);

        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: "5",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0c0e12",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          height,
          width: "100%",
        });
      })
      .catch((err) => console.error("TradingView load error:", err));

    return () => {
      cancelled = true;
      if (mountEl) {
        mountEl.innerHTML = "";
      }
    };
  }, [symbol, height, containerId]);

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-border-low bg-bg3"
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
