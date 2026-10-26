"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { KeyRound, Loader2, ShieldCheck, X } from "lucide-react";
import { BrandMark } from "@/src/components/brand/BrandMark";

export function PrivateKeyPassphraseDialog({
  serverName,
  serverAddress,
  error,
  busy = false,
  title = "Unlock private key",
  description = "This SSH private key is encrypted. Enter its passphrase to continue.",
  onCancel,
  onSubmit,
}: {
  serverName: string;
  serverAddress?: string;
  error?: string | null;
  busy?: boolean;
  title?: string;
  description?: string;
  onCancel: () => void;
  onSubmit: (passphrase: string, remember: boolean) => Promise<void> | void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const working = busy || submitting;

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !working) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, working]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passphrase || working) return;
    setSubmitting(true);
    try {
      await onSubmit(passphrase, remember);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[5px] animate-overlay-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="w-full max-w-[430px] overflow-hidden rounded-[18px] border border-[var(--finder-hairline)] bg-[var(--finder-content)] text-[var(--finder-text)] shadow-[0_24px_80px_rgba(0,0,0,0.3)] animate-sheet-in"
      >
        <header className="flex items-center justify-between border-b border-[var(--finder-hairline)] px-5 py-4">
          <BrandMark
            size={27}
            withWordmark
            wordmarkClassName="text-[13px] font-semibold tracking-tight"
          />
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            aria-label="Close passphrase prompt"
            className="sui-finder-plain-button rounded-lg p-1.5 transition hover:bg-[var(--finder-nav-hover)] disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="px-5 pb-5 pt-6">
            <div className="mb-4 flex size-11 items-center justify-center rounded-[13px] border border-[var(--finder-hairline)] bg-[var(--finder-toolbar)]">
              <KeyRound className="size-5 text-[var(--finder-accent,var(--finder-text))]" />
            </div>
            <h2 id={`${id}-title`} className="text-[18px] font-semibold tracking-tight">
              {title}
            </h2>
            <p
              id={`${id}-description`}
              className="mt-1.5 text-[13px] leading-5 text-[var(--finder-muted)]"
            >
              {description}
            </p>

            <div className="mt-4 rounded-[10px] border border-[var(--finder-hairline)] bg-[var(--finder-toolbar)] px-3 py-2.5">
              <p className="truncate text-[13px] font-medium">{serverName}</p>
              {serverAddress ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--finder-muted)]">
                  {serverAddress}
                </p>
              ) : null}
            </div>

            <label
              htmlFor={`${id}-passphrase`}
              className="mb-1.5 mt-5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--finder-muted)]"
            >
              Private key passphrase
            </label>
            <input
              ref={inputRef}
              id={`${id}-passphrase`}
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : `${id}-privacy`}
              placeholder="Enter passphrase"
              className="sui-server-input"
            />

            {error ? (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-2 text-[12px] leading-5 text-red-500"
              >
                {error}
              </p>
            ) : null}

            <label className="mt-4 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--finder-accent)]"
              />
              <span>
                <span className="block text-[12px] font-medium">
                  Remember passphrase for this server
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[var(--finder-muted)]">
                  {remember
                    ? "Saved with the server credentials using ServerUI's encrypted credential storage."
                    : "Leave unchecked to use it only for this connection. You may be asked again later."}
                </span>
              </span>
            </label>

            <p
              id={`${id}-privacy`}
              className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-[var(--finder-muted)]"
            >
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              Your passphrase is never displayed in server details or sent back by the API.
            </p>
          </div>

          <footer className="flex justify-end gap-2 border-t border-[var(--finder-hairline)] bg-[var(--finder-toolbar)] px-5 py-3.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={working}
              className="sui-finder-plain-button rounded-[8px] px-3 py-2 text-[12px] font-medium transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!passphrase || working}
              className="inline-flex min-w-[125px] items-center justify-center gap-2 rounded-[8px] border border-[var(--finder-control-border)] bg-[var(--finder-control)] px-3.5 py-2 text-[12px] font-semibold text-[var(--finder-text)] transition hover:bg-[var(--finder-control-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {working ? "Unlocking…" : "Continue"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
