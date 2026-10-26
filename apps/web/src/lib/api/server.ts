import { apiBlob, apiRequest } from "@/src/lib/api/client";
import { sampleMetrics } from "@/src/lib/sample-servers";

export type ServerStatus =
  "online" | "offline" | "connecting" | "error" | "authentication_failed" | "unknown";

export type MonitorProcess = {
  pid: number;
  ppid?: number;
  name: string;
  user?: string;
  cpu: number;
  memory: number;
  memoryBytes: number;
  threads?: number;
  state?: string;
  elapsedSeconds?: number;
  command?: string;
  cwd?: string;
};

export type ProcessInspect = {
  command?: string;
  cwd?: string;
  environ?: string[];
  openFiles?: string[];
  sockets?: string[];
};

export type MonitorService = {
  name: string;
  state: string;
  description?: string;
  subState?: string;
  type?: string;
  cpu?: number;
  memory?: number;
  memoryBytes?: number;
  uptimeSeconds?: number;
};

export type MonitorHistoryPoint = {
  t: number;
  cpu: number;
  cpuUser?: number;
  cpuSystem?: number;
  cpuIowait?: number;
  memory: number;
  memUsedBytes?: number;
  memCachedBytes?: number;
  memBuffersBytes?: number;
  memAvailableBytes?: number;
  disk: number;
  diskReadBps?: number;
  diskWriteBps?: number;
  netRx: number;
  netTx: number;
  svcRunning?: number;
  svcStopped?: number;
  svcFailed?: number;
  svcOther?: number;
  cores?: number[];
};

export type MonitorCoreUsage = {
  id: number;
  usage: number;
};

export type MonitorDiskMount = {
  device: string;
  mountPoint: string;
  fsType?: string;
  usedBytes: number;
  totalBytes: number;
  availBytes?: number;
  usage: number;
};

export type MonitorNetProcess = {
  pid: number;
  name: string;
  rxBps: number;
  txBps: number;
  connections?: number;
};

export type ServerInfo = {
  id: string;
  name: string;
  hostname: string;
  status: ServerStatus;
  host: string;
  port?: number;
  username: string;
  authType?: "password" | "private_key";
  iconId?: string;
  customIcon?: boolean;
  updatedAt?: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  uptimeSeconds: number;
  cpuCores?: number;
  cpuPhysicalCores?: number;
  cpuModel?: string;
  cpuUser?: number;
  cpuSystem?: number;
  cpuIowait?: number;
  cpuBaseMHz?: number;
  cpuMaxMHz?: number;
  cpuTempC?: number;
  l1CacheBytes?: number;
  l2CacheBytes?: number;
  l3CacheBytes?: number;
  cores?: MonitorCoreUsage[];
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  memoryAvailableBytes?: number;
  memoryCachedBytes?: number;
  memoryBuffersBytes?: number;
  swapTotalBytes?: number;
  swapUsedBytes?: number;
  swapFreeBytes?: number;
  pageFaults?: number;
  pageFaultsMinor?: number;
  pageFaultsMajor?: number;
  diskUsedBytes?: number;
  diskTotalBytes?: number;
  diskFreeBytes?: number;
  diskReadBps?: number;
  diskWriteBps?: number;
  diskReadIops?: number;
  diskWriteIops?: number;
  diskDevice?: string;
  diskModel?: string;
  diskType?: string;
  diskFSType?: string;
  diskMountOptions?: string;
  diskTempC?: number;
  diskMounts?: MonitorDiskMount[];
  load1?: number;
  load5?: number;
  load15?: number;
  osName?: string;
  kernel?: string;
  arch?: string;
  virtualization?: string;
  ipAddress?: string;
  dockerVersion?: string;
  containerCount?: number;
  netRxBps?: number;
  netTxBps?: number;
  netRxBytes?: number;
  netTxBytes?: number;
  netConns?: number;
  netEstablished?: number;
  netListenPorts?: number[];
  netIface?: string;
  netIfaceType?: string;
  netMAC?: string;
  netIPv4?: string;
  netIPv6?: string;
  netSubnet?: string;
  netGateway?: string;
  netDNS?: string;
  netProcesses?: MonitorNetProcess[];
  processCount?: number;
  processUserCount?: number;
  processSysCount?: number;
  processRunning?: number;
  processes?: MonitorProcess[];
  serviceRunning?: number;
  serviceStopped?: number;
  serviceFailed?: number;
  serviceOther?: number;
  services?: MonitorService[];
  history?: MonitorHistoryPoint[];
  error?: string;
  lastSeen?: string;
  /** Live pooled SSH session. Absent on older responses. */
  connected?: boolean;
};

export type ServerWriteInput = {
  name: string;
  host: string;
  port: number;
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

export type PrivateKeyValidationResult = {
  ok: boolean;
  code?: string;
  error?: string;
};

/** Parses a private key without attempting an SSH connection. */
export function validatePrivateKey(input: {
  privateKey: string;
  privateKeyPassphrase?: string;
}) {
  return apiRequest<PrivateKeyValidationResult>("/api/servers/validate-private-key", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 10000,
  });
}

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  server: ServerInfo;
};

export function getServerIconBlob(serverId: string) {
  return apiBlob(`/api/servers/${encodeURIComponent(serverId)}/icon`);
}

export function getServer(serverId: string, init?: RequestInit) {
  const query = new URLSearchParams({ serverId, _: String(Date.now()) });
  return apiRequest<ServerInfo>(`/api/server?${query.toString()}`, init);
}

export function getServerMetrics(serverId: string, init?: RequestInit) {
  const sample = sampleMetrics(serverId);
  if (sample) return Promise.resolve(sample);
  const query = new URLSearchParams({ serverId, _: String(Date.now()) });
  return apiRequest<ServerInfo>(`/api/server/metrics?${query.toString()}`, {
    ...init,
    timeoutMs: 20000,
  });
}

export async function listServers(init?: RequestInit) {
  const query = new URLSearchParams({ _: String(Date.now()) });
  const body = await apiRequest<{ servers: ServerInfo[] }>(
    `/api/servers?${query.toString()}`,
    init,
  );
  return body.servers || [];
}

export function createServer(input: ServerWriteInput) {
  return apiRequest<ServerInfo>("/api/servers", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 25000,
  });
}

export function updateServer(id: string, input: ServerWriteInput) {
  return apiRequest<ServerInfo>(`/api/servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
    timeoutMs: 25000,
  });
}

export function deleteServer(id: string) {
  return apiRequest<{ status: string }>(`/api/servers/${id}`, {
    method: "DELETE",
  });
}

export function testServerConnection(id: string) {
  return apiRequest<ConnectionTestResult>(`/api/servers/${id}/test-connection`, {
    method: "POST",
    timeoutMs: 25000,
  });
}

export type DraftTestResult = Omit<ConnectionTestResult, "server"> & {
  /** Stable failure code from the backend, including passphrase_required and passphrase_invalid. */
  code?: string;
};

/** Tests unsaved form details; pass serverId when editing to reuse the saved secret. */
export function testServerDraft(
  input: Omit<ServerWriteInput, "name">,
  serverId?: string,
  init?: RequestInit,
) {
  return apiRequest<DraftTestResult>("/api/servers/test-connection", {
    ...init,
    method: "POST",
    body: JSON.stringify({ ...input, serverId }),
    timeoutMs: 25000,
  });
}

export function rememberServerPrivateKeyPassphrase(id: string, passphrase: string) {
  return apiRequest<{ status: string }>(`/api/servers/${id}/private-key-passphrase`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
    timeoutMs: 10000,
  });
}

export function connectServer(
  id: string,
  credentials?: { privateKeyPassphrase?: string; rememberPassphrase?: boolean },
) {
  return apiRequest<ServerInfo>(`/api/servers/${id}/connect`, {
    method: "POST",
    body: JSON.stringify({
      privateKeyPassphrase: credentials?.privateKeyPassphrase,
      rememberPassphrase: credentials?.rememberPassphrase ?? false,
    }),
    timeoutMs: 25000,
  });
}

export function disconnectServer(id: string) {
  return apiRequest<ServerInfo>(`/api/servers/${id}/disconnect`, {
    method: "POST",
    timeoutMs: 15000,
  });
}

export function getProcessInspect(serverId: string, pid: number, init?: RequestInit) {
  const query = new URLSearchParams({ serverId, pid: String(pid), _: String(Date.now()) });
  return apiRequest<ProcessInspect>(`/api/server/process?${query.toString()}`, init);
}

export function killServerProcess(serverId: string, pid: number) {
  return apiRequest<{ ok: boolean; pid: number }>("/api/server/process/kill", {
    method: "POST",
    body: JSON.stringify({ serverId, pid }),
    timeoutMs: 15000,
  });
}

export function controlServerService(
  serverId: string,
  name: string,
  action: "start" | "stop" | "restart",
) {
  return apiRequest<{ ok: boolean; name: string; action: string }>("/api/server/service", {
    method: "POST",
    body: JSON.stringify({ serverId, name, action }),
    timeoutMs: 20000,
  });
}
