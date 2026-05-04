"use client";

import { type ReactNode } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { type Address } from "@solana/kit";

import { BrandLogo } from "../../components/brand-logo";
import { MarketDetailView } from "../../components/market-detail-view";
import { WalletButton } from "../../components/wallet-button";

export default function MarketPage(): ReactNode {
  const params = useParams();
  const raw = params?.marketAddress;
  const marketAddress = (Array.isArray(raw) ? raw[0] : raw) as Address | undefined;

  return (
    <div className="min-h-screen bg-bg1 text-foreground">
      <nav className="sticky top-0 z-50 bg-bg1/80 backdrop-blur-xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-border-low" />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition">
              <BrandLogo priority />
              <span className="text-base font-bold tracking-tight text-foreground">
                SolCast
              </span>
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              <span className="cursor-default rounded-lg px-3 py-1.5 text-sm font-medium text-foreground bg-bg3">
                Market
              </span>
              <Link
                href="/activity"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground-secondary hover:bg-bg2"
              >
                Portfolio
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg bg-bg2 border border-border-low px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse-glow" />
              <span className="text-xs font-medium text-foreground-secondary">Devnet</span>
            </div>
            <WalletButton />
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
        {!marketAddress ? (
          <div className="rounded-2xl border border-border-low bg-bg2 p-8 text-center text-sm text-muted">
            Invalid market link.
            <div className="mt-4">
              <Link href="/" className="font-medium text-primary hover:underline">
                Back to markets
              </Link>
            </div>
          </div>
        ) : (
          <MarketDetailView marketAddress={marketAddress} />
        )}
      </main>

      <footer className="mt-16 border-t border-border-low">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
            <div className="flex items-center gap-3">
              <BrandLogo />
              <span>Built with Anchor + Pyth + @solana/react-hooks</span>
            </div>
            <Link href="/" className="hover:text-foreground-secondary transition-colors">
              ← All markets
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
