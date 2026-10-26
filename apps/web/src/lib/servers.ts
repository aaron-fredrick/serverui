export type ServerStatus =
  | "online"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "error"
  | "authentication_failed"
  | "unknown";

export type Server = {
  id: string;
  name: string;
  hostname: string;
  address: string;
  status: ServerStatus;
  /** True only while the backend holds a live SSH session for this id. */
  connected?: boolean;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  latencyMs?: number;
  metricsError?: string;
  lastSeen?: string;
  sshPort?: number;
  username?: string;
  authType?: "password" | "private_key";
  iconId?: string;
  customIcon?: boolean;
  updatedAt?: string;
  error?: string;
};

/** Live session state. A previous successful test is not a connection. */
export function connectionStatus(server: Server): ServerStatus {
  if (server.status === "connecting" || server.status === "reconnecting") return server.status;
  if (server.connected) return "online";
  if (server.status === "authentication_failed" || server.status === "error") return server.status;
  return "offline";
}

export type NewServerInput = {
  name: string;
  address: string;
  hostname?: string;
  sshPort: number;
  username: string;
  authType: "password" | "private_key";
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
  rememberPrivateKeyPassphrase?: boolean;
  iconId?: string;
  /** Data URL to store, or "" to remove a custom image. Omit to leave it unchanged. */
  iconImage?: string;
};
