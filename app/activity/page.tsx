"use client";

import { type ReactNode } from "react";

import Link from "next/link";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";

import { PositionsList } from "../components/positions-list";
import { WalletButton } from "../components/wallet-button";

function Logo(): ReactNode {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 16L14 10L20 16L14 22Z" fill="white" fillOpacity="0.9" />
      <path d="M14 16L20 10L26 16L20 22Z" fill="white" fillOpacity="0.5" />
    </svg>
  );
}

function WalletNotConnected(): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-bg3 border border-border-low flex items-center justify-center mb-5">
        <svg className="h-8 w-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3"
          />
        </svg>
      </div>
      <h2 className="text-xl font-bold mb-2">Connect your wallet</h2>
      <p className="text-sm text-muted mb-6 text-center max-w-sm">
        Connect a Solana wallet to view your betting activity and positions
      </p>
      <WalletButton />
    </div>
  );
}

interface ActivityContentProps {
  walletAddress: Address;
}

function ActivityContent({ walletAddress }: ActivityContentProps): ReactNode {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Your Portfolio</h2>
          <p className="text-sm text-muted mt-0.5">Track your positions and performance</p>
        </div>
      </div>
      <PositionsList walletAddress={walletAddress} />
    </div>
  );
}

export default function ActivityPage(): ReactNode {
  const { wallet, status } = useWalletConnection();
  const walletAddress = wallet?.account.address;

  return (
    <div className="min-h-screen bg-bg1 text-foreground">
      <nav className="sticky top-0 z-50 bg-bg1/80 backdrop-blur-xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-border-low" />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition">
              <Logo />
              <span className="text-base font-bold tracking-tight text-foreground">
                Prediction Markets
              </span>
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              <Link
                href="/"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground-secondary hover:bg-bg2"
              >
                Markets
              </Link>
              <span className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground bg-bg3">
                Portfolio
              </span>
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
        {status !== "connected" ? (
          <WalletNotConnected />
        ) : (
          <ActivityContent walletAddress={walletAddress!} />
        )}
      </main>

      <footer className="mt-16 border-t border-border-low">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
            <div className="flex items-center gap-3">
              <Logo />
              <span>Built with Anchor + Pyth + @solana/react-hooks</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="https://www.anchor-lang.com/docs" target="_blank" rel="noreferrer" className="hover:text-foreground-secondary transition-colors">Anchor</a>
              <a href="https://solana.com/docs" target="_blank" rel="noreferrer" className="hover:text-foreground-secondary transition-colors">Solana</a>
              <a href="https://pyth.network/" target="_blank" rel="noreferrer" className="hover:text-foreground-secondary transition-colors">Pyth</a>
              <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer" className="hover:text-foreground-secondary transition-colors">Faucet</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
