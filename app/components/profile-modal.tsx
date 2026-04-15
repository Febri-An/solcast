"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useWalletConnection } from "@solana/react-hooks";

import { useProfile } from "../hooks/use-profile";
import { USERNAME_REGEX } from "../lib/profile-challenge";
import { signProfileChallenge } from "../lib/profile-client";

export function ProfileModal(): ReactNode {
  const { wallet, status } = useWalletConnection();
  const {
    profile,
    configured,
    profileModalOpen,
    profileModalTab,
    closeProfileModal,
    refetch,
  } = useProfile();

  const avatarSectionRef = useRef<HTMLDivElement>(null);

  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profileModalOpen && profile?.username) {
      setUsername(profile.username);
    }
    if (profileModalOpen && !profile?.username) {
      setUsername("");
    }
  }, [profileModalOpen, profile?.username]);

  useEffect(() => {
    if (profileModalOpen && profileModalTab === "avatar") {
      avatarSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [profileModalOpen, profileModalTab]);

  const address = status === "connected" ? wallet?.account.address.toString() : undefined;

  const handleSaveUsername = useCallback(async () => {
    if (!wallet || !address) return;
    const u = username.trim();
    if (!USERNAME_REGEX.test(u)) {
      setStatusMsg("Username: 3–32 characters, letters, numbers, or underscore.");
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      const { message, signature } = await signProfileChallenge(wallet, address);
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, message, signature, username: u }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save");
      }
      await refetch();
      setStatusMsg("Profile saved.");
      closeProfileModal();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [wallet, address, username, refetch, closeProfileModal]);

  const handleAvatarChange = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file || !wallet || !address) return;
      setUploading(true);
      setStatusMsg(null);
      try {
        const { message, signature } = await signProfileChallenge(wallet, address);
        const form = new FormData();
        form.set("wallet", address);
        form.set("message", message);
        form.set("signature", signature);
        form.set("file", file);
        const res = await fetch("/api/profile/avatar", {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to upload");
        }
        await refetch();
        setStatusMsg("Profile picture updated.");
        closeProfileModal();
      } catch (e) {
        setStatusMsg(e instanceof Error ? e.message : "Failed to upload");
      } finally {
        setUploading(false);
      }
    },
    [wallet, address, refetch, closeProfileModal],
  );

  if (!profileModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={closeProfileModal}
      />
      <div className="relative z-[101] w-full max-w-md rounded-2xl border border-border-low bg-bg2 shadow-2xl shadow-black/50 overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between border-b border-border-low px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Profile settings</h2>
          <button
            type="button"
            onClick={closeProfileModal}
            className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-bg3 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {configured && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    disabled={saving}
                    autoComplete="off"
                    className="w-full rounded-xl border border-border-low bg-bg3 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
                  />
                  <p className="mt-1.5 text-[11px] text-muted">3–32 characters: letters, numbers, underscore.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveUsername()}
                  disabled={saving || !address}
                  className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save username"}
                </button>
              </div>

              <div
                ref={avatarSectionRef}
                id="profile-avatar-upload"
                className="space-y-3 border-t border-border-low pt-5 scroll-mt-4"
              >
                <label className="block text-xs font-medium text-foreground-secondary">Foto profil</label>
                <p className="text-[11px] text-muted">JPEG, PNG, or Webp — max. 2MB.</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading || !address}
                  onChange={(e) => void handleAvatarChange(e.target.files)}
                  className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-bg3 file:px-3 file:py-2 file:text-sm file:text-foreground-secondary"
                />
                {uploading && <p className="text-xs text-muted">Uploading…</p>}
              </div>
            </div>
          )}

          {statusMsg && <p className="text-xs text-muted">{statusMsg}</p>}
        </div>
      </div>
    </div>
  );
}
