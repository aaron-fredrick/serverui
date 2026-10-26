import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listServers, connectServer, disconnectServer, getServerMetrics } = vi.hoisted(() => ({
  listServers: vi.fn(),
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  getServerMetrics: vi.fn(),
}));

vi.mock("@/src/lib/api/server", () => ({
  listServers: (...args: unknown[]) => listServers(...args),
  connectServer: (...args: unknown[]) => connectServer(...args),
  disconnectServer: (...args: unknown[]) => disconnectServer(...args),
  getServerMetrics: (...args: unknown[]) => getServerMetrics(...args),
  createServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  testServerConnection: vi.fn(),
}));

import { ApiError } from "@/src/lib/api/client";
import { SessionProvider, useSession } from "@/src/lib/session";

const inventory = [
  {
    id: "a",
    name: "Production",
    host: "203.0.113.10",
    port: 22,
    username: "deploy",
    authType: "password",
    status: "offline",
    connected: false,
  },
  {
    id: "b",
    name: "Homelab",
    host: "203.0.113.20",
    port: 22,
    username: "deploy",
    authType: "password",
    status: "online",
    connected: true,
  },
];

function Probe() {
  const { servers, connectServer: connect, disconnectServer: disconnect } = useSession();
  return (
    <>
      <button type="button" onClick={() => void connect("a")}>
        Connect A
      </button>
      <button type="button" onClick={() => void disconnect("b")}>
        Disconnect B
      </button>
      <ul>
        {servers.map((item) => (
          <li key={item.id}>
            {item.id}:{item.connected ? "live" : "down"}:{item.status}
          </li>
        ))}
      </ul>
    </>
  );
}

describe("session connection isolation", () => {
  beforeEach(() => {
    listServers.mockReset();
    connectServer.mockReset();
    disconnectServer.mockReset();
    getServerMetrics.mockReset();
    listServers.mockResolvedValue(inventory);
    getServerMetrics.mockResolvedValue({
      id: "b",
      name: "Homelab",
      host: "203.0.113.20",
      status: "online",
      connected: true,
      username: "deploy",
      cpuUsage: 12,
      memoryUsage: 40,
      diskUsage: 55,
      uptimeSeconds: 10,
    });
  });

  it("connects one server without clearing another live session", async () => {
    const user = userEvent.setup();
    connectServer.mockResolvedValue({
      id: "a",
      name: "Production",
      host: "203.0.113.10",
      status: "online",
      connected: true,
      username: "deploy",
    });

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText("b:live:online")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect A" }));

    await waitFor(() => {
      expect(screen.getByText("a:live:online")).toBeInTheDocument();
    });
    expect(screen.getByText("b:live:online")).toBeInTheDocument();
    expect(disconnectServer).not.toHaveBeenCalled();
  });

  it(
    "prompts for an encrypted SSH key and retries without losing the server selection",
    async () => {
      const user = userEvent.setup();
      listServers.mockResolvedValue([
        { ...inventory[0], authType: "private_key" },
        inventory[1],
      ]);
      connectServer
        .mockRejectedValueOnce(
          new ApiError(
            "This private key is encrypted. Enter its passphrase to continue.",
            400,
            "passphrase_required",
          ),
        )
        .mockResolvedValueOnce({
          id: "a",
          name: "Production",
          host: "203.0.113.10",
          status: "online",
          connected: true,
          username: "deploy",
        });

      render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );

      await user.click(await screen.findByRole("button", { name: "Connect A" }));
      expect(
        await screen.findByRole("dialog", { name: "Unlock private key" }),
      ).toBeInTheDocument();
      await user.type(screen.getByLabelText("Private key passphrase"), "correct horse");
      await user.click(
        screen.getByRole("checkbox", { name: /Remember passphrase for this server/ }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => {
        expect(connectServer).toHaveBeenNthCalledWith(2, "a", {
          privateKeyPassphrase: "correct horse",
          rememberPassphrase: true,
        });
      });
      await waitFor(() => {
        expect(screen.getByText("a:live:online")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("dialog", { name: "Unlock private key" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("b:live:online")).toBeInTheDocument();
    },
  );

  it("does not ask for metrics until a server is connected", async () => {
    listServers.mockResolvedValue([
      { ...inventory[0] },
      { ...inventory[1], status: "offline", connected: false },
    ]);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText("a:down:offline")).toBeInTheDocument();
    expect(getServerMetrics).not.toHaveBeenCalled();
  });
});
