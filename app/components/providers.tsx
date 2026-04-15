"use client";

import { type ReactNode } from "react";

import { autoDiscover, createClient } from "@solana/client";
import { SolanaProvider } from "@solana/react-hooks";

import { ProfileModal } from "./profile-modal";
import { ToastProvider } from "./toast";
import { ProfileProvider } from "../hooks/use-profile";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";

const client = createClient({
  endpoint: DEVNET_RPC_URL,
  walletConnectors: autoDiscover(),
  commitment: "confirmed",
});

const queryConfig = {
  refreshInterval: 3000,
  dedupingInterval: 1000,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
};

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps): ReactNode {
  return (
    <SolanaProvider client={client} query={{ config: queryConfig }}>
      <ProfileProvider>
        <ToastProvider>
          {children}
          <ProfileModal />
        </ToastProvider>
      </ProfileProvider>
    </SolanaProvider>
  );
}
