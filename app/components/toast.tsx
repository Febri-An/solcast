"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "loading" | "info";

interface ToastState {
  message: string;
  variant: ToastVariant;
  durationMs?: number;
}

const AUTO_DISMISS_MS = 3800;

const ToastContext = createContext<{
  showToast: (
    message: string,
    options?: { variant?: ToastVariant; durationMs?: number },
  ) => void;
} | null>(null);

export function useToast(): {
  showToast: (
    message: string,
    options?: { variant?: ToastVariant; durationMs?: number },
  ) => void;
} {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

function CheckCircleIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-green-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function AlertCircleIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-red-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
      />
    </svg>
  );
}

function InfoCircleIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-amber"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function LoadingIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 shrink-0 animate-spin text-primary"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): ReactNode {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeoutMs = toast.durationMs ?? (toast.variant === "loading" ? undefined : AUTO_DISMISS_MS);
    if (!timeoutMs || timeoutMs <= 0) return;
    const id = window.setTimeout(() => setToast(null), timeoutMs);
    return () => clearTimeout(id);
  }, [toast]);

  const showToast = useCallback(
    (
      message: string,
      options?: { variant?: ToastVariant; durationMs?: number },
    ) => {
      setToast({
        message,
        variant: options?.variant ?? "success",
        durationMs: options?.durationMs,
      });
    },
    [],
  );

  const isSuccess = toast?.variant === "success";
  const isLoading = toast?.variant === "loading";
  const isInfo = toast?.variant === "info";

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed bottom-6 left-1/2 z-[60] flex max-w-[min(100vw-2rem,22rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl border bg-bg2 px-4 py-3 text-sm font-medium text-foreground shadow-lg shadow-black/40 animate-fade-in ${
            isLoading
              ? "border-primary/25"
              : isSuccess
                ? "border-green/25"
                : isInfo
                  ? "border-amber/25"
                  : "border-red/25"
          }`}
        >
          {isLoading ? (
            <LoadingIcon />
          ) : isSuccess ? (
            <CheckCircleIcon />
          ) : isInfo ? (
            <InfoCircleIcon />
          ) : (
            <AlertCircleIcon />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}
