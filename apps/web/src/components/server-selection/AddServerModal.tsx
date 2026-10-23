"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, ImagePlus, Loader2, PlugZap, X, XCircle } from "lucide-react";
import { ServerIcon } from "@/src/components/servers/ServerIcon";
import { ServerIconPicker } from "@/src/components/servers/ServerIconPicker";
import { readServerLogo } from "@/src/lib/server-logo";
import { DEFAULT_SERVER_ICON, type ServerIconId } from "@/src/lib/server-icons";
import { testServerDraft } from "@/src/lib/api/server";
import { formatConnectionTestMessage } from "@/src/lib/errors";
import type { NewServerInput, Server } from "@/src/lib/servers";
import {
  FIELD_ORDER,
  validateServerForm,
  type AuthMethod,
  type FieldErrors,
  type ServerField,
  type ValidationScope,
} from "@/src/lib/server-validation";
import { formatApiError } from "@/src/lib/session";

type TestState = {
  /** Snapshot of the tested fields; the result is hidden once they change. */
  key: string;
  status: "testing" | "ok" | "fail";
  message?: string;
};

const NEUTRAL_BUTTON =
  "border-[var(--finder-control-border)] bg-[var(--finder-control)] text-[var(--finder-text)] hover:bg-[var(--finder-control-hover)]";

/** Icon and colours for each Test Connection state, shared by the button and result line. */
const TEST_UI = {
  idle: { Icon: PlugZap, line: "", button: NEUTRAL_BUTTON },
  testing: {
    Icon: Loader2,
    line: "bg-[var(--finder-nav-hover)] text-[var(--finder-muted)]",
    button: NEUTRAL_BUTTON,
  },
  ok: {
    Icon: CheckCircle2,
    line: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    button:
      "border-emerald-500/40 bg-emerald-500/12 text-emerald-600 hover:bg-emerald-500/18 dark:text-emerald-300",
  },
  fail: {
    Icon: XCircle,
    line: "bg-red-500/10 text-red-600 dark:text-red-300",
    button: "border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/16 dark:text-red-300",
  },
} as const;

export function AddServerModal({
  server,
  busy,
  error,
  connectAfterSave = false,
  contained = false,
  layout = "dialog",
  onNameChange,
  onAppearanceChange,
  onClose,
  onSubmit,
}: {
  server?: Server | null;
  busy?: boolean;
  error?: string | null;
  /** When true, primary action saves then the parent may connect immediately. */
  connectAfterSave?: boolean;
  /** Keep the sheet inside the parent window instead of covering the desktop. */
  contained?: boolean;
  /** `pane` fills the parent. `dialog` is the floating sheet. */
  layout?: "dialog" | "pane";
  /** Reports the name field so a temporary sidebar tab can follow it. */
  onNameChange?: (name: string) => void;
  /** Reports the icon and any unsaved custom image for the temporary sidebar tab. */
  onAppearanceChange?: (appearance: { iconId: string; preview: string | null }) => void;
  onClose: () => void;
  onSubmit: (input: NewServerInput, options?: { connect?: boolean }) => Promise<void> | void;
}) {
  const editing = Boolean(server);
  const pane = layout === "pane";
  const titleId = useId();
  const fieldId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server?.name || "");
  const [address, setAddress] = useState(server?.address || "");
  const [port, setPort] = useState(String(server?.sshPort || 22));
  const [username, setUsername] = useState(server?.username || "");
  const [auth, setAuth] = useState<AuthMethod>(server?.authType || "password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [iconId, setIconId] = useState(server?.iconId || DEFAULT_SERVER_ICON);
  /** null keeps a saved custom image. "" removes it. A data URL is a new upload. */
  const [iconImage, setIconImage] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  // Errors show after a field is edited and left, or for all fields on Save/Test.
  const [touched, setTouched] = useState<Set<ServerField>>(new Set());
  const [edited, setEdited] = useState<Set<ServerField>>(new Set());
  const [attempt, setAttempt] = useState<ValidationScope | null>(null);
  const [test, setTest] = useState<TestState | null>(null);
  const testAbort = useRef<AbortController | null>(null);

  const values = { name, host: address, port, username, auth, password, privateKey };
  const context = { editing, savedAuth: server?.authType };
  const errors = validateServerForm(values, context, "save");
  const visibleErrors: FieldErrors = {};
  for (const field of FIELD_ORDER) {
    const shown =
      touched.has(field) || attempt === "save" || (attempt === "connection" && field !== "name");
    if (shown && errors[field]) visibleErrors[field] = errors[field];
  }
  const errorCount = Object.keys(visibleErrors).length;

  const fieldsKey = JSON.stringify([
    address.trim(),
    port,
    username.trim(),
    auth,
    password,
    privateKey,
  ]);
  const visibleTest = test?.key === fieldsKey ? test : null;
  const testUi = TEST_UI[visibleTest?.status ?? "idle"];
  const spin = visibleTest?.status === "testing" ? " animate-spin" : "";

  // Cancel an in-flight test when the modal closes.
  useEffect(() => () => testAbort.current?.abort(), []);

  // Mount only: a parent re-render hands in a new onClose and must not pull focus back here.
  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ids = (field: ServerField) => ({
    input: `${fieldId}-${field}`,
    error: `${fieldId}-${field}-error`,
  });

  /** Props that wire an input to its inline error. */
  function fieldProps(field: ServerField) {
    const message = visibleErrors[field];
    return {
      id: ids(field).input,
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? ids(field).error : undefined,
      onInput: () =>
        setEdited((current) => (current.has(field) ? current : new Set(current).add(field))),
      onBlur: () => {
        if (!edited.has(field)) return;
        setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
      },
    };
  }

  /** Shows errors for the scope; focuses the first invalid field. Returns true when valid. */
  function check(scope: ValidationScope) {
    setAttempt((current) => (current === "save" ? current : scope));
    const found = validateServerForm(values, context, scope);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (!first) return true;
    const input = document.getElementById(ids(first).input);
    input?.focus();
    input?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return false;
  }

  async function runTest() {
    if (!check("connection")) return;
    testAbort.current?.abort();
    const controller = new AbortController();
    testAbort.current = controller;
    const key = fieldsKey;
    setTest({ key, status: "testing" });
    try {
      const result = await testServerDraft(
        {
          host: address.trim(),
          port: Number(port),
          username: username.trim(),
          authType: auth,
          password: auth === "password" ? password.trim() || undefined : undefined,
          privateKey: auth === "private_key" ? privateKey.trim() || undefined : undefined,
        },
        server?.id,
        { signal: controller.signal },
      );
      // The backend's failure text is already user-facing, so show it as-is.
      setTest(
        result.ok
          ? { key, status: "ok", message: formatConnectionTestMessage(true, result.latencyMs) }
          : { key, status: "fail", message: result.error || "Connection failed." },
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setTest({
        key,
        status: "fail",
        message: formatConnectionTestMessage(false, undefined, formatApiError(err, "")),
      });
    }
  }

  function reportAppearance(nextId: string, preview: string | null) {
    onAppearanceChange?.({ iconId: nextId, preview });
  }

  function selectIcon(id: ServerIconId) {
    setIconId(id);
    setIconImage("");
    setIconError(null);
    reportAppearance(id, "");
  }

  function chooseIconFile(file: File | undefined) {
    if (!file) return;
    setIconError(null);
    void readServerLogo(file)
      .then((value) => {
        setIconImage(value);
        reportAppearance(iconId, value);
      })
      .catch((err: unknown) => {
        setIconError(err instanceof Error ? err.message : "Unable to read that image.");
      });
  }

  function clearCustomIcon() {
    setIconImage("");
    setIconError(null);
    reportAppearance(iconId, "");
    if (iconInput.current) iconInput.current.value = "";
  }

  const customActive = iconImage ? true : iconImage === null && Boolean(server?.customIcon);

  async function submit(event: FormEvent, connect?: boolean) {
    event.preventDefault();
    if (iconError || !check("save")) return;
    await onSubmit(
      {
        name: name.trim(),
        address: address.trim(),
        hostname: address.trim(),
        sshPort: Number(port),
        username: username.trim(),
        authType: auth,
        password: password.trim() || undefined,
        privateKey: privateKey.trim() || undefined,
        iconId,
        ...(iconImage !== null ? { iconImage } : {}),
      },
      { connect },
    );
  }

  const form = (
    <form
      noValidate
      onSubmit={(event) => void submit(event, false)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        className={
          pane
            ? "min-h-0 flex-1 space-y-4 overflow-y-auto"
            : "min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        }
      >
        <div className="rounded-[12px] border border-[var(--finder-hairline)] bg-[var(--finder-toolbar)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="sui-finder-muted text-[11px] font-medium uppercase tracking-[0.14em]">
              Server Icon
            </span>
            <span className="flex size-9 items-center justify-center">
              <ServerIcon
                iconId={iconId}
                customIcon={server?.customIcon}
                serverId={server?.id}
                updatedAt={server?.updatedAt}
                preview={iconImage}
                size={32}
              />
            </span>
          </div>
          <ServerIconPicker value={iconId} onChange={selectIcon} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              ref={iconInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Custom server icon"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                chooseIconFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => iconInput.current?.click()}
              className="sui-finder-control inline-flex h-[28px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium"
            >
              <ImagePlus className="size-3.5" />
              {customActive ? "Replace Image" : "Choose Image"}
            </button>
            {customActive ? (
              <button
                type="button"
                onClick={clearCustomIcon}
                className="sui-finder-plain-button rounded-[8px] px-2.5 py-1 text-[12px] font-medium"
              >
                Remove Image
              </button>
            ) : null}
            {iconError ? (
              <p className="flex min-w-0 items-start gap-1.5 text-[12px] leading-5 text-red-500">
                <XCircle aria-hidden className="mt-[3px] size-3.5 shrink-0" />
                {iconError}
              </p>
            ) : (
              <p className="sui-finder-muted min-w-0 text-[12px] leading-5">
                PNG, JPEG, or WebP. A custom image replaces the preset until you remove it.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Server Name" error={visibleErrors.name} errorId={ids("name").error}>
            <input
              ref={firstField}
              {...fieldProps("name")}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                onNameChange?.(event.target.value);
              }}
              className="sui-server-input"
              placeholder="Production"
              autoComplete="off"
            />
          </Field>
          <Field label="Host / IP" error={visibleErrors.host} errorId={ids("host").error}>
            <input
              {...fieldProps("host")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="sui-server-input"
              placeholder="203.0.113.10"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <Field label="SSH Port" error={visibleErrors.port} errorId={ids("port").error}>
            <input
              {...fieldProps("port")}
              value={port}
              onChange={(event) => setPort(event.target.value)}
              className="sui-server-input"
              inputMode="numeric"
              placeholder="22"
            />
          </Field>
          <Field label="Username" error={visibleErrors.username} errorId={ids("username").error}>
            <input
              {...fieldProps("username")}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="sui-server-input"
              placeholder="deploy"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <fieldset className="col-span-2">
            <legend className="sui-finder-muted mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em]">
              Authentication
            </legend>
            <div
              className="sui-finder-segment flex rounded-[8px] p-px"
              role="group"
              aria-label="Authentication method"
            >
              <AuthChoice
                selected={auth === "password"}
                onSelect={() => setAuth("password")}
                label="Password"
              />
              <AuthChoice
                selected={auth === "private_key"}
                onSelect={() => setAuth("private_key")}
                label="SSH Private Key"
              />
            </div>
          </fieldset>

          {auth === "password" ? (
            <Field
              className="col-span-2"
              label="Password"
              error={visibleErrors.secret}
              errorId={ids("secret").error}
            >
              <input
                {...fieldProps("secret")}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="sui-server-input"
                placeholder={editing ? "Leave unchanged" : "••••••••••••"}
                autoComplete="new-password"
              />
            </Field>
          ) : (
            <Field
              className="col-span-2"
              label="Private Key"
              error={visibleErrors.secret}
              errorId={ids("secret").error}
              hint="Your private key is encrypted before being stored. Passphrase-protected keys are not supported yet."
            >
              <textarea
                {...fieldProps("secret")}
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                className="sui-server-input min-h-[96px] resize-y font-mono text-[12px] leading-5"
                placeholder={
                  editing
                    ? "Leave unchanged"
                    : "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
                }
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          )}
        </div>
      </div>

      <div
        className={`shrink-0 space-y-2 ${
          pane
            ? "border-t border-[var(--finder-hairline)] bg-[var(--finder-content)] pt-3"
            : "border-t border-[var(--finder-hairline)] px-4 py-3.5"
        }`}
      >
        {attempt && errorCount ? (
          <p className="text-[12px] text-red-500" role="alert">
            {errorCount === 1
              ? "Fix the highlighted field to continue."
              : `Fix the ${errorCount} highlighted fields to continue.`}
          </p>
        ) : error ? (
          <p className="text-[12px] text-red-500" role="alert">
            {error}
          </p>
        ) : null}

        {visibleTest ? (
          <p
            role="status"
            aria-live="polite"
            className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-5 ${testUi.line}`}
          >
            <testUi.Icon aria-hidden className={`mt-0.5 size-3.5 shrink-0${spin}`} />
            <span>
              {visibleTest.status === "testing"
                ? `Connecting to ${address.trim()}…`
                : visibleTest.message}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={busy || visibleTest?.status === "testing"}
            data-result={visibleTest?.status}
            className={`inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${testUi.button}`}
          >
            <testUi.Icon aria-hidden className={`size-3.5${spin}`} />
            {visibleTest?.status === "testing" ? "Testing…" : "Test Connection"}
          </button>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="sui-finder-plain-button rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition"
            >
              Cancel
            </button>
            {connectAfterSave && !editing ? (
              <button
                type="button"
                disabled={busy}
                onClick={(event) => void submit(event, true)}
                className="rounded-[8px] bg-[var(--finder-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save & Connect"}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                connectAfterSave && !editing
                  ? "sui-finder-control"
                  : "bg-[var(--finder-accent)] text-white hover:brightness-110"
              }`}
            >
              {busy ? "Saving…" : "Save Server"}
            </button>
          </div>
        </div>
        <p className="sui-finder-muted text-[11px] leading-5">
          Test Connection checks these details without saving them.
          {editing ? " A blank password or key uses the saved one." : null}
        </p>
      </div>
    </form>
  );

  if (pane) {
    return (
      <div className="animate-pane-in mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        {form}
      </div>
    );
  }

  return (
    <div
      className={`animate-overlay-in inset-0 flex items-start justify-center bg-black/40 p-4 backdrop-blur-[2px] ${
        contained ? "absolute z-[30] pt-6" : "fixed z-[80] pt-[12vh]"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sui-finder animate-sheet-in flex max-h-[min(720px,100%)] w-full max-w-[640px] flex-col overflow-hidden rounded-[12px] border border-[var(--finder-hairline)] bg-[var(--finder-toolbar)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--finder-hairline)] px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {editing ? "Edit Server" : "Add Server"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="sui-finder-plain-button flex size-7 items-center justify-center rounded-full transition"
          >
            <X className="size-4" />
          </button>
        </div>
        {form}
      </div>
    </div>
  );
}

function AuthChoice({
  selected,
  onSelect,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-active={selected}
      className="sui-finder-segment-button flex-1 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition"
    >
      {label}
    </button>
  );
}

function Field({
  label,
  error,
  errorId,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  errorId: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block">
        <span className="sui-finder-muted mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em]">
          {label}
        </span>
        {children}
      </label>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-5 text-red-500"
        >
          <XCircle aria-hidden className="mt-[3px] size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      {hint ? <p className="sui-finder-muted mt-2 text-[12px] leading-5">{hint}</p> : null}
    </div>
  );
}
