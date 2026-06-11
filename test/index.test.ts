import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetConfig = vi.fn();
const mockSubscribe = vi.fn();
const mockCloseConfig = vi.fn();
const mockReady = vi.fn();
const mockRegisterInstance = vi.fn();
const mockSelectInstances = vi.fn();
const mockDeregisterInstance = vi.fn();
const mockLoadNacosModule = vi.fn();
const mockNacosConfigClient = vi.fn(() => ({
  getConfig: mockGetConfig,
  subscribe: mockSubscribe,
  close: mockCloseConfig,
}));
const mockNacosNamingClient = vi.fn(() => ({
  ready: mockReady,
  registerInstance: mockRegisterInstance,
  selectInstances: mockSelectInstances,
  deregisterInstance: mockDeregisterInstance,
}));

vi.mock("nacos", () => {
  mockLoadNacosModule();
  return {
    NacosConfigClient: mockNacosConfigClient,
    NacosNamingClient: mockNacosNamingClient,
  };
});

vi.mock("vextjs", () => ({
  definePlugin: (plugin: unknown) => plugin,
}));

import {
  createNacosBootstrapProvider,
  nacosPlugin,
} from "../src/index.js";

function createAppMock(nacos: Record<string, unknown>) {
  const closeHandlers: Array<() => Promise<void> | void> = [];
  const app: any = {
    config: { nacos },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    extend: vi.fn((key: string, value: unknown) => {
      (app as Record<string, unknown>)[key] = value;
    }),
    onClose: vi.fn((handler: () => Promise<void> | void) => {
      closeHandlers.push(handler);
    }),
  };

  return { app, closeHandlers };
}

describe("createNacosBootstrapProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not create SDK client until load()", async () => {
    mockGetConfig.mockResolvedValue(JSON.stringify({ ok: true }));

    const provider = createNacosBootstrapProvider({
      serverAddr: "127.0.0.1:8848",
      config: { dataId: "app.json" },
    });

    expect(mockNacosConfigClient).not.toHaveBeenCalled();
    expect(mockLoadNacosModule).not.toHaveBeenCalled();

    await provider.load();

    expect(mockLoadNacosModule).toHaveBeenCalledTimes(1);
    expect(mockNacosConfigClient).toHaveBeenCalledTimes(1);
  });

  it("loads and deep merges config + configs in declaration order", async () => {
    mockGetConfig.mockImplementation(async (dataId: string) => {
      if (dataId === "base.json") {
        return JSON.stringify({
          database: {
            config: {
              url: "mongodb://base",
              poolSize: 10,
            },
          },
          features: {
            a: true,
          },
        });
      }

      if (dataId === "db.json") {
        return JSON.stringify({
          database: {
            config: {
              ssh: {
                host: "127.0.0.1",
                port: 22,
              },
            },
          },
        });
      }

      if (dataId === "override.json") {
        return JSON.stringify({
          database: {
            config: {
              poolSize: 20,
            },
          },
          features: {
            b: true,
          },
          tags: ["override"],
        });
      }

      return null;
    });

    const provider = createNacosBootstrapProvider({
      name: "admin-nacos-bootstrap",
      serverAddr: "127.0.0.1:8848",
      config: { dataId: "base.json", group: "admin-service" },
      configs: [
        { dataId: "db.json", group: "admin-service" },
        { dataId: "override.json", group: "admin-service" },
      ],
    });

    const patch = await provider.load();

    expect(provider.name).toBe("admin-nacos-bootstrap");
    expect(mockGetConfig).toHaveBeenCalledTimes(3);
    expect(patch).toEqual({
      database: {
        config: {
          url: "mongodb://base",
          poolSize: 20,
          ssh: {
            host: "127.0.0.1",
            port: 22,
          },
        },
      },
      features: {
        a: true,
        b: true,
      },
      tags: ["override"],
    });
    expect(mockCloseConfig).toHaveBeenCalledTimes(1);
  });

  it("throws when no config source is provided", () => {
    expect(() =>
      createNacosBootstrapProvider({
        serverAddr: "127.0.0.1:8848",
      }),
    ).toThrow("requires config or configs");
  });
});

describe("nacosPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enabled=false does not create clients", async () => {
    const { app } = createAppMock({
      enabled: false,
      serverAddr: "127.0.0.1:8848",
      config: { dataId: "base.json" },
      service: { name: "svc", ip: "127.0.0.1", port: 3000 },
    });

    await nacosPlugin().setup(app as never);

    expect(mockLoadNacosModule).not.toHaveBeenCalled();
    expect(mockNacosConfigClient).not.toHaveBeenCalled();
    expect(mockNacosNamingClient).not.toHaveBeenCalled();
    expect(app.onClose).not.toHaveBeenCalled();
    expect(app.logger.debug).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("serverAddr missing does not create clients", async () => {
    const { app } = createAppMock({
      config: { dataId: "base.json" },
    });

    await nacosPlugin().setup(app as never);

    expect(mockLoadNacosModule).not.toHaveBeenCalled();
    expect(mockNacosConfigClient).not.toHaveBeenCalled();
    expect(mockNacosNamingClient).not.toHaveBeenCalled();
    expect(app.logger.debug).toHaveBeenCalledWith(expect.stringContaining("serverAddr"));
  });

  it("serverAddr without config/service stays no-op", async () => {
    const { app } = createAppMock({
      serverAddr: "127.0.0.1:8848",
    });

    await nacosPlugin().setup(app as never);

    expect(mockLoadNacosModule).not.toHaveBeenCalled();
    expect(mockNacosConfigClient).not.toHaveBeenCalled();
    expect(mockNacosNamingClient).not.toHaveBeenCalled();
    expect(app.logger.debug).toHaveBeenCalledWith(expect.stringContaining("no config/service"));
  });

  it("merges multiple remote configs and updates merged state on subscription", async () => {
    const subscribers = new Map<string, (content: unknown) => void>();

    mockGetConfig.mockImplementation(async (dataId: string) => {
      if (dataId === "base.json") {
        return JSON.stringify({
          logger: { level: "info" },
          features: { search: true },
          tags: ["base"],
        });
      }

      if (dataId === "db.json") {
        return JSON.stringify({
          database: { config: { url: "mongodb://db" } },
        });
      }

      return null;
    });

    mockSubscribe.mockImplementation(
      (
        entry: { dataId: string; group: string },
        callback: (content: unknown) => void,
      ) => {
        subscribers.set(`${entry.dataId}@${entry.group}`, callback);
      },
    );

    const { app, closeHandlers } = createAppMock({
      serverAddr: "127.0.0.1:8848",
      config: { dataId: "base.json", group: "admin-service" },
      configs: [{ dataId: "db.json", group: "admin-service" }],
    });

    const plugin = nacosPlugin();
    await plugin.setup(app as never);

    expect(app.remoteConfig).toEqual({
      logger: { level: "info" },
      features: { search: true },
      tags: ["base"],
      database: { config: { url: "mongodb://db" } },
    });

    subscribers
      .get("db.json@admin-service")
      ?.(JSON.stringify({ database: { config: { url: "mongodb://override", poolSize: 20 } } }));

    expect(app.remoteConfig).toEqual({
      logger: { level: "info" },
      features: { search: true },
      tags: ["base"],
      database: {
        config: {
          url: "mongodb://override",
          poolSize: 20,
        },
      },
    });

    await closeHandlers[0]?.();
    expect(mockCloseConfig).toHaveBeenCalledTimes(1);
  });

  it("registers and deregisters service when service config exists", async () => {
    mockReady.mockResolvedValue(undefined);
    mockRegisterInstance.mockResolvedValue(undefined);
    mockSelectInstances.mockResolvedValue([{ ip: "10.0.0.5", port: 3001 }]);
    mockDeregisterInstance.mockResolvedValue(undefined);

    const { app, closeHandlers } = createAppMock({
      serverAddr: "127.0.0.1:8848",
      service: {
        name: "order-service",
        ip: "127.0.0.1",
        port: 3000,
        metadata: { version: "1.0.0" },
      },
    });

    await nacosPlugin().setup(app as never);

    expect(mockNacosNamingClient).toHaveBeenCalledTimes(1);
    expect(mockReady).toHaveBeenCalledTimes(1);
    expect(mockRegisterInstance).toHaveBeenCalledWith(
      "order-service",
      { ip: "127.0.0.1", port: 3000, metadata: { version: "1.0.0" } },
      "DEFAULT_GROUP",
    );

    await expect(app.nacos.discover("user-service")).resolves.toBe("http://10.0.0.5:3001");

    await closeHandlers[0]?.();
    expect(mockDeregisterInstance).toHaveBeenCalledWith(
      "order-service",
      { ip: "127.0.0.1", port: 3000 },
      "DEFAULT_GROUP",
    );
  });
});

