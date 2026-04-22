"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { useWalletConnection } from "@solana/react-hooks";

import { useProfile } from "../hooks/use-profile";

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function ProfileMenu(): ReactNode {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const { profile, isComplete, configured, isLoading, openProfileModal } = useProfile();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const address = wallet?.account.address.toString();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border-low bg-bg2 px-3.5 py-2 text-sm text-muted">
        Connecting...
      </div>
    );
  }

  if (status !== "connected" || !address) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Connect Wallet
        </button>
        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border-low bg-bg2 shadow-2xl shadow-black/40 z-50 overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-medium text-muted uppercase tracking-wider">Select wallet</p>
            </div>
            <div className="p-2">
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  type="button"
                  onClick={() => {
                    void connect(connector.id);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 w-full rounded-lg px-3 py-3 text-sm font-medium text-foreground-secondary transition-colors hover:bg-bg3 hover:text-foreground"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg3 border border-border-low">
                    <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3"
                      />
                    </svg>
                  </div>
                  {connector.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const displayName = profile?.username?.trim() || "Profil";

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:block h-6 w-px bg-border-low shrink-0" aria-hidden />

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 pl-1 sm:pl-0"
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border-low bg-bg3">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded dynamic URL from Supabase
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                className="block h-full w-full bg-gradient-to-br from-amber-200/80 via-amber-700/60 to-violet-500/90"
                aria-hidden
              />
            )}
          </span>
          <ChevronIcon open={isOpen} />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border-low bg-bg2 shadow-2xl shadow-black/40 z-50 overflow-hidden">
            <div className="p-4 border-b border-border-low">
              <p className="text-xs text-muted mb-1">Profil</p>
              <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
              {configured && !isLoading && !isComplete && (
                <p className="mt-2 text-[11px] text-amber leading-relaxed rounded-md bg-amber-muted/80 border border-amber/20 px-2 py-1.5">
                  Complete your username to start trading and creating markets.
                </p>
              )}
              <p className="font-mono text-[11px] text-muted break-all mt-2">{address}</p>
            </div>
            <div className="p-2">
              <button
                type="button"
                onClick={() => {
                  openProfileModal("username");
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm text-foreground-secondary transition-colors hover:bg-bg3 hover:text-foreground"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                Edit username
              </button>
              <button
                type="button"
                onClick={() => {
                  openProfileModal("avatar");
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm text-foreground-secondary transition-colors hover:bg-bg3 hover:text-foreground"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                Change profile picture
              </button>
              <a
                href="https://faucet.solana.com/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm text-foreground-secondary transition-colors hover:bg-bg3 hover:text-foreground"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Get devnet SOL
              </a>
              <button
                type="button"
                onClick={() => {
                  void disconnect();
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm text-red-text transition-colors hover:bg-red-muted"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
