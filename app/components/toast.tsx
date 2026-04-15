"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error";

interface ToastState {
  message: string;
  variant: ToastVariant;
}

const AUTO_DISMISS_MS = 3800;

const ToastContext = createContext<{
  showToast: (message: string, options?: { variant?: ToastVariant }) => void;
} | null>(null);

export function useToast(): {
  showToast: (message: string, options?: { variant?: ToastVariant }) => void;
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

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): ReactNode {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const showToast = useCallback(
    (message: string, options?: { variant?: ToastVariant }) => {
      setToast({
        message,
        variant: options?.variant ?? "success",
      });
    },
    [],
  );

  const isSuccess = toast?.variant === "success";

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed bottom-6 left-1/2 z-[60] flex max-w-[min(100vw-2rem,22rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl border bg-bg2 px-4 py-3 text-sm font-medium text-foreground shadow-lg shadow-black/40 animate-fade-in ${
            isSuccess ? "border-green/25" : "border-red/25"
          }`}
        >
          {isSuccess ? <CheckCircleIcon /> : <AlertCircleIcon />}
          <span>{toast.message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}
