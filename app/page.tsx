"use client";

import { type ReactNode, useEffect, useState } from "react";

import Link from "next/link";
import { useWalletConnection } from "@solana/react-hooks";

import { BrandLogo } from "./components/brand-logo";
import { CreateMarketForm } from "./components/create-market-form";
import { MarketsList, type MarketsFilterTab } from "./components/markets-list";
import { useToast } from "./components/toast";
import { WalletButton } from "./components/wallet-button";
import { useProfile } from "./hooks/use-profile";

function PlusIcon(): ReactNode {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    num: "01",
    title: "Create a market",
    description: "Pick an asset, set a target price and deadline. The market goes live immediately.",
  },
  {
    num: "02",
    title: "Place your bets",
    description: "Stake SOL on YES or NO before the deadline. Prices reflect crowd probability.",
  },
  {
    num: "03",
    title: "Oracle resolves",
    description: "After the deadline, anyone can trigger resolution using live Pyth oracle prices.",
  },
  {
    num: "04",
    title: "Claim winnings",
    description: "Winners split the losing pool proportionally. Withdraw your SOL instantly.",
  },
];

function HowItWorks(): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted hover:text-foreground-secondary transition-colors"
      >
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        How it works
      </button>

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div
              key={step.num}
              className="rounded-xl border border-border-low bg-bg2 p-4"
            >
              <span className="text-xs font-mono font-bold text-primary">{step.num}</span>
              <h4 className="mt-1.5 text-sm font-semibold text-foreground">{step.title}</h4>
              <p className="mt-1 text-xs leading-relaxed text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET;

export default function Home(): ReactNode {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [marketsTab, setMarketsTab] = useState<MarketsFilterTab>("active");
  const { showToast } = useToast();
  const { status, wallet } = useWalletConnection();
  const { isComplete: isProfileComplete, configured, openProfileModal } = useProfile();

  const currentAddress =
    status === "connected" ? wallet?.account.address.toString() : undefined;
  const isAdmin = Boolean(
    ADMIN_WALLET && currentAddress && currentAddress === ADMIN_WALLET,
  );

  function handleNewMarketClick(): void {
    if (configured && status === "connected" && !isProfileComplete) {
      openProfileModal("username");
      return;
    }
    setShowCreateForm(!showCreateForm);
  }

  useEffect(() => {
    if (marketsTab !== "active" && showCreateForm) {
      setShowCreateForm(false);
    }
  }, [marketsTab, showCreateForm]);

  return (
    <div className="min-h-screen bg-bg1 text-foreground">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-bg1/80 backdrop-blur-xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-border-low" />
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
              <BrandLogo priority />
              <span className="text-base font-bold tracking-tight text-foreground">
                SolCast
              </span>
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              <span className="cursor-default rounded-lg px-3 py-1.5 text-sm font-medium text-foreground bg-bg3">
                Markets
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

      {/* Main content */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-6">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Explore Markets</h2>
            <p className="text-sm text-muted mt-0.5">
              Trade on crypto price outcomes. Powered by Pyth oracles on Solana.
            </p>
          </div>
          {marketsTab === "active" && isAdmin && (
            <button
              type="button"
              onClick={handleNewMarketClick}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
                showCreateForm
                  ? "bg-bg3 text-foreground-secondary border border-border-low"
                  : "bg-primary text-white hover:bg-primary-hover"
              }`}
            >
              <PlusIcon />
              {showCreateForm ? "Cancel" : "New Market"}
            </button>
          )}
        </div>

        {showCreateForm && isAdmin && (
          <div className="mb-6">
            <CreateMarketForm
              onCreated={() => {
                setShowCreateForm(false);
                showToast("Market created successfully.");
              }}
            />
          </div>
        )}

        <MarketsList activeTab={marketsTab} onActiveTabChange={setMarketsTab} />

        <HowItWorks />
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-border-low">
        <div className="mx-auto max-w-[1440px] px-4 py-6 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
            <div className="flex items-center gap-3">
              <BrandLogo />
              <span>Built with Anchor + Pyth + @solana/react-hooks</span>
            </div>
            <div className="flex items-center gap-5">
              <a
                href="https://www.anchor-lang.com/docs"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground-secondary transition-colors"
              >
                Anchor
              </a>
              <a
                href="https://solana.com/docs"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground-secondary transition-colors"
              >
                Solana
              </a>
              <a
                href="https://pyth.network/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground-secondary transition-colors"
              >
                Pyth
              </a>
              <a
                href="https://faucet.solana.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground-secondary transition-colors"
              >
                Faucet
              </a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
