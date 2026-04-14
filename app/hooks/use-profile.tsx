"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useWalletConnection } from "@solana/react-hooks";

export type ProfileRow = {
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  updated_at?: string;
};

type ProfileModalTab = "username" | "avatar";

type ProfileContextValue = {
  profile: ProfileRow | null;
  configured: boolean;
  isLoading: boolean;
  isComplete: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  profileModalOpen: boolean;
  profileModalTab: ProfileModalTab;
  openProfileModal: (tab?: ProfileModalTab) => void;
  closeProfileModal: () => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }): ReactNode {
  const { wallet, status } = useWalletConnection();
  const address = status === "connected" ? wallet?.account.address.toString() : undefined;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [configured, setConfigured] = useState(false);
  const [hasFetchedProfile, setHasFetchedProfile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState<ProfileModalTab>("username");

  const refetch = useCallback(async () => {
    if (!address) {
      setProfile(null);
      setConfigured(false);
      setHasFetchedProfile(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/profile?wallet=${encodeURIComponent(address)}`);
      const data = (await res.json()) as {
        profile?: ProfileRow | null;
        configured?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Gagal memuat profil");
      }
      setConfigured(data.configured === true);
      setProfile(data.profile ?? null);
      setHasFetchedProfile(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat profil");
      setProfile(null);
      setHasFetchedProfile(true);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const isComplete = useMemo(() => {
    if (!address) return true;
    if (!hasFetchedProfile) return false;
    if (!configured) return true;
    return Boolean(profile?.username?.trim());
  }, [address, hasFetchedProfile, configured, profile?.username]);

  const openProfileModal = useCallback((tab: ProfileModalTab = "username") => {
    setProfileModalTab(tab);
    setProfileModalOpen(true);
  }, []);

  const closeProfileModal = useCallback(() => {
    setProfileModalOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      profile,
      configured,
      isLoading,
      isComplete,
      error,
      refetch,
      profileModalOpen,
      profileModalTab,
      openProfileModal,
      closeProfileModal,
    }),
    [
      profile,
      configured,
      isLoading,
      isComplete,
      error,
      refetch,
      profileModalOpen,
      profileModalTab,
      openProfileModal,
      closeProfileModal,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return ctx;
}
