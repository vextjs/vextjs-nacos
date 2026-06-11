import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadNacosModule = vi.fn();
const mockNacosConfigClient = vi.fn(() => ({
  getConfig: vi.fn(async () => JSON.stringify({ ok: true })),
  subscribe: vi.fn(),
  close: vi.fn(),
}));
const mockNacosNamingClient = vi.fn(() => ({
  ready: vi.fn(),
  registerInstance: vi.fn(),
  selectInstances: vi.fn(),
  deregisterInstance: vi.fn(),
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

function createAppMock(nacos: Record<string, unknown>) {
  return {
    config: { nacos },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    extend: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("nacos lazy import", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not load nacos SDK for no-op plugin setup", async () => {
    const { nacosPlugin } = await import("../src/index.js");
    const app = createAppMock({});

    await nacosPlugin().setup(app as never);

    expect(mockLoadNacosModule).not.toHaveBeenCalled();
    expect(mockNacosConfigClient).not.toHaveBeenCalled();
    expect(mockNacosNamingClient).not.toHaveBeenCalled();
  });

  it("loads nacos SDK only when config/service requires a client", async () => {
    const { nacosPlugin } = await import("../src/index.js");
    const app = createAppMock({
      serverAddr: "127.0.0.1:8848",
      config: { dataId: "base.json" },
    });

    await nacosPlugin().setup(app as never);

    expect(mockLoadNacosModule).toHaveBeenCalledTimes(1);
    expect(mockNacosConfigClient).toHaveBeenCalledTimes(1);
  });
});
