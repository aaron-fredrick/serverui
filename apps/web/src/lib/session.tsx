"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "@/src/lib/api/client";
import {
  PrivateKeyPassphraseDialog,
} from "@/src/components/server-selection/PrivateKeyPassphraseDialog";
import { type NewServerInput, type Server, type ServerStatus } from "@/src/lib/servers";
import { isSampleServer, mergeSampleServers } from "@/src/lib/sample-servers";
import { useWindowServerId } from "@/src/lib/window-server";
import {
  connectServer as connectServerApi,
  createServer,
  deleteServer as deleteServerApi,
  disconnectServer as disconnectServerApi,
  getServerMetrics,
  listServers,
  testServerConnection,
  updateServer as updateServerApi,
  type ConnectionTestResult,
  type ServerInfo,
} from "@/src/lib/api/server";

export type AppScreen = "server-selection" | "booting" | "logging-off" | "desktop";

type SessionContextValue = {
  screen: AppScreen;
  servers: Server[];
  selectedServer: Server | null;
  loadingServers: boolean;
  serversError: string | null;
  refreshServers: () => Promise<Server[]>;
  selectServer: (server: Server) => boolean;
  connectServer: (
    id: string,
    credentials?: { privateKeyPassphrase?: string; rememberPassphrase?: boolean },
  ) => Promise<Server | null>;
  disconnectServer: (id: string) => Promise<void>;
  reconnectServer: (id: string) => Promise<Server | null>;
  addServer: (input: NewServerInput) => Promise<Server>;
  updateServer: (id: string, input: NewServerInput) => Promise<Server>;
  deleteServer: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<ConnectionTestResult>;
  completeBoot: () => void;
  logOut: () => void;
  completeLogOut: () => void;
  backToServers: () => void;
  retryBoot: () => void;
  switchServer: (server: Server) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function asStatus(value: string | undefined): ServerStatus {
  switch (value) {
    case "online":
    case "offline":
    case "connecting":
    case "error":
    case "authentication_failed":
    case "reconnecting":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function keepMetrics(previous: Server | undefined, next: Server): Server {
  if (!previous) return next;
  return {
    ...next,
    cpuUsage: next.cpuUsage ?? previous.cpuUsage,
    memoryUsage: next.memoryUsage ?? previous.memoryUsage,
    diskUsage: next.diskUsage ?? previous.diskUsage,
    latencyMs: next.latencyMs ?? previous.latencyMs,
    metricsError: next.metricsError ?? previous.metricsError,
  };
}

export function toSessionServer(info: ServerInfo): Server {
  const hostname = info.hostname || info.host;
  return {
    id: info.id,
    name: info.name || hostname,
    hostname,
    address: info.host,
    status: asStatus(info.status),
    sshPort: info.port,
    username: info.username,
    authType: info.authType,
    iconId: info.iconId || "server",
    customIcon: info.customIcon === true,
    updatedAt: info.updatedAt,
    error: info.error,
    lastSeen: info.lastSeen,
    connected: info.connected === true,
    cpuUsage: typeof info.cpuUsage === "number" ? info.cpuUsage : undefined,
    memoryUsage: typeof info.memoryUsage === "number" ? info.memoryUsage : undefined,
    diskUsage: typeof info.diskUsage === "number" ? info.diskUsage : undefined,
  };
}

function toWriteInput(input: NewServerInput) {
  return {
    name: input.name.trim(),
    host: input.address.trim(),
    port: input.sshPort,
    username: input.username.trim(),
    authType: input.authType,
    password: input.password,
    privateKey: input.privateKey,
    privateKeyPassphrase: input.privateKeyPassphrase,
    rememberPrivateKeyPassphrase: input.rememberPrivateKeyPassphrase,
    iconId: input.iconId,
    ...(input.iconImage !== undefined ? { iconImage: input.iconImage } : {}),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<AppScreen>("desktop");
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [loadingServers, setLoadingServers] = useState(true);
  const [serversError, setServersError] = useState<string | null>(null);
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    server: Server;
    error?: string | null;
    busy?: boolean;
  } | null>(null);

  const refreshServers = useCallback(async () => {
    try {
      const items = await listServers();
      const next = mergeSampleServers(items.map(toSessionServer));
      setServers((current) =>
        next.map((item) =>
          keepMetrics(
            current.find((row) => row.id === item.id),
            item,
          ),
        ),
      );
      setServersError(null);
      setSelectedServer((current) => {
        if (!current) return current;
        return next.find((item) => item.id === current.id) || current;
      });
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unable to load servers";
      setServersError(message);
      setServers([]);
      return [];
    } finally {
      setLoadingServers(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listServers()
      .then((items) => {
        if (cancelled) return;
        setServers((current) =>
          mergeSampleServers(
            items.map((item) => {
              const mapped = toSessionServer(item);
              return keepMetrics(
                current.find((row) => row.id === mapped.id),
                mapped,
              );
            }),
          ),
        );
        setServersError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "unable to load servers";
        setServersError(message);
        setServers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingServers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedKey = servers
    .filter((item) => item.connected)
    .map((item) => item.id)
    .join("\n");

  useEffect(() => {
    const ids = connectedKey ? connectedKey.split("\n") : [];
    let cancelled = false;

    async function pullMetrics() {
      if (!ids.length) return;
      const queue = [...ids];
      const worker = async () => {
        while (!cancelled && queue.length > 0) {
          const id = queue.shift();
          if (!id) return;
          try {
            const info = await getServerMetrics(id);
            if (cancelled) return;
            setServers((current) =>
              current.map((item) =>
                item.id === id && item.connected
                  ? {
                      ...item,
                      cpuUsage: info.cpuUsage,
                      memoryUsage: info.memoryUsage,
                      diskUsage: info.diskUsage,
                      metricsError: undefined,
                    }
                  : item,
              ),
            );
          } catch {
            if (cancelled) return;
            setServers((current) =>
              current.map((item) =>
                item.id === id ? { ...item, metricsError: "Metrics unavailable" } : item,
              ),
            );
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
    }

    if (ids.length) void pullMetrics();
    const timer = window.setInterval(() => {
      void refreshServers();
      void pullMetrics();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connectedKey, refreshServers]);

  const patchServer = useCallback((id: string, patch: Partial<Server>) => {
    setServers((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const connectServer = useCallback(
    async (
      id: string,
      credentials?: { privateKeyPassphrase?: string; rememberPassphrase?: boolean },
    ) => {
      if (isSampleServer(id)) {
        throw new Error("Sample servers are preview data and do not open an SSH session.");
      }
      patchServer(id, { status: "connecting", error: undefined });
      const started = Date.now();
      try {
        const info = await connectServerApi(id, credentials);
        const next = {
          ...toSessionServer(info),
          connected: true,
          latencyMs: Date.now() - started,
        };
        setServers((current) =>
          current.map((item) => (item.id === id ? keepMetrics(item, next) : item)),
        );
        setSelectedServer(next);
        return next;
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.code === "passphrase_required" || err.code === "passphrase_invalid")
        ) {
          const server = servers.find((item) => item.id === id) ?? {
            id,
            name: "SSH server",
            hostname: "",
            address: "",
            status: "offline" as const,
            connected: false,
          };
          patchServer(id, { status: "offline", error: undefined });
          setPassphrasePrompt({
            server,
            error: err.code === "passphrase_invalid" ? err.message : null,
            busy: false,
          });
          return null;
        }
        await refreshServers();
        throw err;
      }
    },
    [patchServer, refreshServers, servers],
  );

  const submitPassphrase = useCallback(
    async (passphrase: string, rememberPassphrase: boolean) => {
      const pending = passphrasePrompt;
      if (!pending) return;
      setPassphrasePrompt((current) =>
        current ? { ...current, busy: true, error: null } : current,
      );
      try {
        const info = await connectServerApi(pending.server.id, {
          privateKeyPassphrase: passphrase,
          rememberPassphrase,
        });
        const next = {
          ...toSessionServer(info),
          connected: true,
        };
        setServers((current) =>
          current.map((item) =>
            item.id === pending.server.id ? keepMetrics(item, next) : item,
          ),
        );
        setSelectedServer(next);
        setPassphrasePrompt(null);
      } catch (err) {
        const message = err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to connect. Check the passphrase and try again.";
        setPassphrasePrompt((current) =>
          current ? { ...current, busy: false, error: message } : current,
        );
      }
    },
    [passphrasePrompt],
  );

  const disconnectServer = useCallback(async (id: string) => {
    if (isSampleServer(id)) {
      throw new Error("Sample servers are preview data and do not open an SSH session.");
    }
    const info = await disconnectServerApi(id);
    const next = toSessionServer(info);
    next.connected = false;
    setServers((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...next,
              cpuUsage: undefined,
              memoryUsage: undefined,
              diskUsage: undefined,
              metricsError: undefined,
            }
          : item,
      ),
    );
    setSelectedServer((current) => (current?.id === id ? next : current));
  }, []);

  const reconnectServer = useCallback(
    async (id: string) => {
      patchServer(id, { status: "reconnecting", error: undefined, connected: false });
      try {
        await disconnectServerApi(id);
      } catch {
        // The session may already be gone. Connecting again is the recovery.
      }
      return connectServer(id);
    },
    [connectServer, patchServer],
  );

  const selectServer = useCallback(
    (server: Server) => {
      setSelectedServer(server);
      void connectServer(server.id).catch(() => undefined);
      return true;
    },
    [connectServer],
  );

  const addServer = useCallback(async (input: NewServerInput) => {
    const created = toSessionServer(await createServer(toWriteInput(input)));
    setServers((current) => {
      if (current.some((item) => item.id === created.id)) return current;
      return [...current, created];
    });
    return created;
  }, []);

  const updateServer = useCallback(async (id: string, input: NewServerInput) => {
    if (isSampleServer(id)) {
      throw new Error("Sample servers are preview data and cannot be edited.");
    }
    const updated = toSessionServer(await updateServerApi(id, toWriteInput(input)));
    setServers((current) => current.map((item) => (item.id === id ? updated : item)));
    setSelectedServer((current) => (current?.id === id ? updated : current));
    return updated;
  }, []);

  const deleteServer = useCallback(async (id: string) => {
    if (isSampleServer(id)) {
      throw new Error(
        "Sample servers are preview data. They disappear when this development session stops.",
      );
    }
    await deleteServerApi(id);
    setServers((current) => current.filter((item) => item.id !== id));
    setSelectedServer((current) => (current?.id === id ? null : current));
  }, []);

  const testConnection = useCallback(async (id: string) => {
    if (isSampleServer(id)) {
      throw new Error("Sample servers are preview data and do not open an SSH session.");
    }
    const result = await testServerConnection(id);
    const next = toSessionServer(result.server);
    setServers((current) => current.map((item) => (item.id === id ? next : item)));
    return result;
  }, []);

  const completeBoot = useCallback(() => {
    setScreen("desktop");
  }, []);

  const logOut = useCallback(() => {
    setScreen("desktop");
  }, []);

  const completeLogOut = useCallback(() => {
    setScreen("desktop");
  }, []);

  const backToServers = useCallback(() => {
    setScreen("desktop");
  }, []);

  const retryBoot = useCallback(() => {
    setScreen("desktop");
  }, []);

  // Highlight a server without closing any other session or leaving the desktop.
  const switchServer = useCallback((server: Server) => {
    setSelectedServer(server);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      screen,
      servers,
      selectedServer,
      loadingServers,
      serversError,
      refreshServers,
      selectServer,
      connectServer,
      disconnectServer,
      reconnectServer,
      addServer,
      updateServer,
      deleteServer,
      testConnection,
      completeBoot,
      logOut,
      completeLogOut,
      backToServers,
      retryBoot,
      switchServer,
    }),
    [
      screen,
      servers,
      selectedServer,
      loadingServers,
      serversError,
      refreshServers,
      selectServer,
      connectServer,
      disconnectServer,
      reconnectServer,
      addServer,
      updateServer,
      deleteServer,
      testConnection,
      completeBoot,
      logOut,
      completeLogOut,
      backToServers,
      retryBoot,
      switchServer,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {passphrasePrompt ? (
        <PrivateKeyPassphraseDialog
          serverName={passphrasePrompt.server.name}
          serverAddress={passphrasePrompt.server.address}
          error={passphrasePrompt.error}
          busy={passphrasePrompt.busy}
          onCancel={() => setPassphrasePrompt(null)}
          onSubmit={submitPassphrase}
        />
      ) : null}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}

export function useSelectedServer() {
  const scoped = useWindowServerId();
  const context = useContext(SessionContext);
  if (scoped === undefined) return context?.selectedServer ?? null;
  if (!scoped) return null;
  const found = context?.servers.find((item) => item.id === scoped);
  if (found) return found;
  const removed: Server = {
    id: scoped,
    name: "Removed server",
    hostname: "",
    address: "",
    status: "offline",
    connected: false,
  };
  return removed;
}

export function formatApiError(err: unknown, fallback = "request failed") {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
