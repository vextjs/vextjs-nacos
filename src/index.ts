/**
 * @devcodex/nacos — VextJS 官方 Nacos 集成插件
 *
 * 功能：
 *   - 服务注册与发现（NacosNamingClient）
 *   - 动态配置中心（NacosConfigClient）
 *   - 完整 TypeScript 类型增强（VextApp.nacos / VextApp.remoteConfig / VextConfig.nacos）
 *
 * 用法：
 *   // src/plugins/nacos.ts
 *   import { nacosPlugin } from "@devcodex/nacos";
 *   export default nacosPlugin();   // 读取 vext.config.ts 中的 nacos 配置
 *
 *   // 或显式传参：
 *   export default nacosPlugin({
 *     serverAddr: "127.0.0.1:8848",
 *     service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
 *     config: { dataId: "order-service", group: "DEFAULT_GROUP" },
 *   });
 *
 * @module @devcodex/nacos
 */

import { definePlugin } from "vextjs";
import type { VextApp, VextPluginContext } from "vextjs";

interface NacosConfigClientLike {
  getConfig(dataId: string, group: string): Promise<unknown>;
  subscribe(
    entry: { dataId: string; group: string },
    callback: (content: unknown) => void,
  ): void;
  close(): void | Promise<void>;
}

interface NacosNamingClientLike {
  ready(): Promise<void>;
  registerInstance(
    serviceName: string,
    instance: unknown,
    groupName?: string,
  ): Promise<void>;
  selectInstances(
    serviceName: string,
    groupName?: string,
    clusters?: string,
    healthy?: boolean,
  ): Promise<Array<{ ip: string; port: number }>>;
  deregisterInstance(
    serviceName: string,
    instance: unknown,
    groupName?: string,
  ): Promise<void>;
  close(): Promise<void>;
}

interface NacosSdkLike {
  NacosConfigClient: new (options: Record<string, unknown>) => NacosConfigClientLike;
  NacosNamingClient: new (options: Record<string, unknown>) => NacosNamingClientLike;
}

let nacosSdkPromise: Promise<NacosSdkLike> | undefined;

async function loadNacosSdk(): Promise<NacosSdkLike> {
  nacosSdkPromise ??= import("nacos").then((sdk) => sdk as unknown as NacosSdkLike);
  try {
    return await nacosSdkPromise;
  } catch (error) {
    nacosSdkPromise = undefined;
    throw error;
  }
}

// ── 公共类型定义 ────────────────────────────────────────────

export interface NacosServiceOptions {
  /** 服务名 */
  name: string;
  /** 分组，默认 "DEFAULT_GROUP" */
  group?: string;
  /** 服务实例 IP */
  ip: string;
  /** 服务实例端口 */
  port: number;
  /** 实例元数据 */
  metadata?: Record<string, string>;
}

export interface NacosConfigOptions {
  /** Nacos 配置 dataId */
  dataId: string;
  /** 配置分组，默认 "DEFAULT_GROUP" */
  group?: string;
}

export interface NacosPluginOptions {
  /** 全局开关；false 时不加载 nacos SDK、不创建客户端 */
  enabled?: boolean;
  /** Nacos 服务器地址，如 "127.0.0.1:8848" */
  serverAddr?: string;
  /** 命名空间，默认 "public" */
  namespace?: string;
  /** Nacos 鉴权用户名（开启鉴权的 Nacos 必填）*/
  username?: string;
  /** Nacos 鉴权密码（开启鉴权的 Nacos 必填）*/
  password?: string;
  /** 服务注册配置（缺省则不注册当前服务）*/
  service?: NacosServiceOptions;
  /** 单个配置中心配置（缺省则不订阅配置）*/
  config?: NacosConfigOptions;
  /** 多个配置中心配置（按声明顺序深合并，后者优先）*/
  configs?: NacosConfigOptions[];
}

export interface NacosBootstrapProviderOptions {
  /** provider 名称，默认 `nacos-bootstrap-provider` */
  name?: string;
  /** provider 超时（毫秒） */
  timeoutMs?: number;
  /** provider 是否必需 */
  required?: boolean;
  /** Nacos 服务器地址，如 "127.0.0.1:8848" */
  serverAddr: string;
  /** 命名空间，默认 "public" */
  namespace?: string;
  /** Nacos 鉴权用户名 */
  username?: string;
  /** Nacos 鉴权密码 */
  password?: string;
  /** 单个配置中心配置 */
  config?: NacosConfigOptions;
  /** 多个配置中心配置（按声明顺序深合并，后者优先） */
  configs?: NacosConfigOptions[];
}

export interface NacosBootstrapProvider {
  /** provider 名称 */
  name: string;
  /** provider 超时（毫秒） */
  timeoutMs?: number;
  /** provider 是否必需 */
  required?: boolean;
  /** 加载启动期配置 patch */
  load(): Promise<Record<string, unknown>>;
}

export interface NacosExtension {
  /** NacosNamingClient 原生实例，可直接调用 SDK 全部 API */
  naming: NacosNamingClientLike;
  /**
   * 服务发现（随机负载均衡，仅返回健康实例）
   * @param serviceName 目标服务名
   * @param group       分组，默认 "DEFAULT_GROUP"
   * @returns "http://ip:port"
   * @throws 当无健康实例时抛出 Error
   */
  discover(serviceName: string, group?: string): Promise<string>;
}

// ── declare module "vextjs"：类型自动扩展 ───────────────────

declare module "vextjs" {
  interface VextApp {
    /** Nacos 集成对象（由 vextjs-nacos 插件挂载） */
    nacos?: NacosExtension;
    /** 来自 Nacos 配置中心的远程配置 */
    remoteConfig?: Record<string, any>;
  }
  interface VextConfig {
    /** Nacos 插件配置（同 NacosPluginOptions）*/
    nacos?: NacosPluginOptions;
  }
}

// ── 内部辅助 ───────────────────────────────────────────────

/**
 * 将 nacos SDK 的 logger 接口（一元 string 签名）桥接到 app.logger
 * NacosNamingClientConfig.logger 在 nacos@2.6.1 中是必填字段（typeof console）。
 */
function createNacosLogger(app: VextPluginContext) {
  return {
    info(msg: string) { app.logger.debug({ source: "nacos" }, msg); },
    warn(msg: string) { app.logger.warn({ source: "nacos" }, msg); },
    error(msg: string) { app.logger.error({ source: "nacos" }, msg); },
    debug(msg: string) { app.logger.debug({ source: "nacos" }, msg); },
    log(msg: string) { app.logger.debug({ source: "nacos" }, msg); },
  };
}

// nacos SDK 的 Instance 类型要求 instanceId 必填且不含 metadata 字段，
// 实际 SDK 内部会自动生成 instanceId，业务调用时只需传 ip/port/metadata。
// register/deregister 调用处使用 `as any` 局部断言。

const DEFAULT_GROUP = "DEFAULT_GROUP";
const DEFAULT_NAMESPACE = "public";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target } as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    const current = result[key];

    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function normalizeConfigEntries(options: {
  config?: NacosConfigOptions;
  configs?: NacosConfigOptions[];
}): Array<Required<NacosConfigOptions>> {
  const entries = [
    ...(options.config ? [options.config] : []),
    ...(options.configs ?? []),
  ];

  return entries.map((entry, index) => {
    if (!entry?.dataId || typeof entry.dataId !== "string") {
      throw new Error(
        `[vextjs-nacos] Invalid config entry at index ${index}: dataId is required.`,
      );
    }

    return {
      dataId: entry.dataId,
      group: entry.group ?? DEFAULT_GROUP,
    };
  });
}

function createConfigClientOptions(options: {
  serverAddr: string;
  namespace?: string;
  username?: string;
  password?: string;
}) {
  return {
    serverAddr: options.serverAddr,
    namespace: options.namespace ?? DEFAULT_NAMESPACE,
    username: options.username,
    password: options.password,
  };
}

function parseConfigObject(
  raw: string,
  label: string,
): Record<string, unknown> | null {
  if (!raw.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[vextjs-nacos] Config parse failed for ${label}: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `[vextjs-nacos] Config ${label} must be a JSON object to merge into Vext config.`,
    );
  }

  return parsed;
}

async function loadConfigEntry(
  configClient: NacosConfigClientLike,
  entry: Required<NacosConfigOptions>,
): Promise<Record<string, unknown> | null> {
  const raw = await configClient.getConfig(entry.dataId, entry.group);
  return typeof raw === "string"
    ? parseConfigObject(raw, `${entry.dataId}@${entry.group}`)
    : null;
}

function mergeConfigEntries(
  entries: Array<Required<NacosConfigOptions>>,
  state: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  return entries.reduce<Record<string, unknown>>((merged, entry) => {
    const patch = state.get(`${entry.dataId}@${entry.group}`);
    return patch ? deepMerge(merged, patch) : merged;
  }, {});
}

export function createNacosBootstrapProvider(
  options: NacosBootstrapProviderOptions,
): NacosBootstrapProvider {
  if (!options.serverAddr) {
    throw new Error("[vextjs-nacos] createNacosBootstrapProvider requires serverAddr.");
  }

  const entries = normalizeConfigEntries(options);
  if (entries.length === 0) {
    throw new Error(
      "[vextjs-nacos] createNacosBootstrapProvider requires config or configs.",
    );
  }

  return {
    name: options.name ?? "nacos-bootstrap-provider",
    timeoutMs: options.timeoutMs,
    required: options.required,
    async load() {
      const { NacosConfigClient } = await loadNacosSdk();
      const configClient = new NacosConfigClient(createConfigClientOptions(options));

      try {
        const state = new Map<string, Record<string, unknown>>();

        for (const entry of entries) {
          const patch = await loadConfigEntry(configClient, entry);
          if (patch) {
            state.set(`${entry.dataId}@${entry.group}`, patch);
          }
        }

        return mergeConfigEntries(entries, state);
      } finally {
        await configClient.close();
      }
    },
  };
}

// ── 插件工厂 ───────────────────────────────────────────────

/**
 * nacosPlugin — VextJS 官方 Nacos 插件
 *
 * @param options 显式选项；与 app.config.nacos 合并（options 优先）
 */
export function nacosPlugin(options: Partial<NacosPluginOptions> = {}) {
  return definePlugin({
    name: "nacos",

    async setup(app) {
      // ── 1. 选项合并 ────────────────────────────────────
      const opts: Partial<NacosPluginOptions> = {
        ...(app.config.nacos ?? {}),
        ...options,
      };

      if (opts.enabled === false) {
        app.logger.debug("[vextjs-nacos] disabled, skipping setup");
        return;
      }

      if (!opts.serverAddr) {
        app.logger.debug("[vextjs-nacos] serverAddr missing, plugin disabled");
        return;
      }

      const configEntries = normalizeConfigEntries(opts);

      if (configEntries.length === 0 && !opts.service) {
        app.logger.debug("[vextjs-nacos] no config/service configured, plugin disabled");
        return;
      }

      const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
      const logger = createNacosLogger(app);
      const { NacosConfigClient, NacosNamingClient } = await loadNacosSdk();

      // ⚠️ LIFO 顺序设计：
      //   先处理 config（先注册 config.close onClose → LIFO 后执行）
      //   再处理 service（后注册 deregister onClose → LIFO 先执行：先停流量）
      // 这样保证关闭时：先 deregister（停流量）→ 再 config.close

      // ── 2. 配置中心（config 配置存在时，先处理）─────────
      if (configEntries.length > 0) {
        const configClient = new NacosConfigClient(
          createConfigClientOptions({
            serverAddr: opts.serverAddr,
            namespace,
            username: opts.username,
            password: opts.password,
          }),
        );
        // ❌ NacosConfigClient 在 nacos@2.6.1 中没有 ready() 方法

        const state = new Map<string, Record<string, unknown>>();
        const remoteConfigState: Record<string, unknown> = {};
        let remoteConfigAttached = false;

        const syncRemoteConfig = () => {
          const merged = mergeConfigEntries(configEntries, state);
          for (const key of Object.keys(remoteConfigState)) {
            delete remoteConfigState[key];
          }
          Object.assign(remoteConfigState, merged);

          if (!remoteConfigAttached) {
            app.extend("remoteConfig", remoteConfigState);
            remoteConfigAttached = true;
          }
        };

        for (const entry of configEntries) {
          const key = `${entry.dataId}@${entry.group}`;

          try {
            const patch = await loadConfigEntry(configClient, entry);
            if (patch) {
              state.set(key, patch);
              syncRemoteConfig();
              app.logger.info(`[vextjs-nacos] Remote config loaded: ${key}`);
            }
          } catch (err) {
            app.logger.warn(
              `[vextjs-nacos] Initial config fetch failed: ${(err as Error).message}`,
            );
          }

          // 监听变更
          configClient.subscribe(
            { dataId: entry.dataId, group: entry.group },
            (content: unknown) => {
              if (typeof content !== "string") return;

              let patch: Record<string, unknown> | null;
              try {
                patch = parseConfigObject(content, key);
              } catch (err) {
                app.logger.warn((err as Error).message);
                return;
              }

              try {
                if (patch) {
                  state.set(key, patch);
                } else {
                  state.delete(key);
                }

                syncRemoteConfig();
                app.logger.info(`[vextjs-nacos] Remote config updated: ${key}`);
              } catch (err) {
                app.logger.warn(
                  `[vextjs-nacos] Remote config update failed for ${key}: ${(err as Error).message}`,
                );
              }
            },
          );
        }

        // 配置客户端关闭 onClose（先注册 → LIFO 后执行）
        app.onClose(async () => {
          try {
            await configClient.close();
            app.logger.debug("[vextjs-nacos] Config client closed");
          } catch (err) {
            app.logger.warn(
              `[vextjs-nacos] Config client close failed: ${(err as Error).message}`,
            );
          }
        });
      }

      // ── 3. 服务注册与发现（service 配置存在时，后处理）───
      if (opts.service) {
        const { name, group, ip, port, metadata } = opts.service;
        const groupName = group ?? DEFAULT_GROUP;

        const namingClient = new NacosNamingClient({
          // nacos SDK 类型声明 logger 为 typeof console（含 assert/clear 等 17+ 方法），
          // 实际只调用 info/warn/error/debug/log，所以用 unknown 跨类型断言
          logger: logger as unknown as typeof console,
          serverList: opts.serverAddr,   // ⚠️ NamingClient 字段名是 serverList
          namespace,
          username: opts.username,
          password: opts.password,
        });

        await namingClient.ready();

        // nacos Instance 类型要求 instanceId 必填（实际 SDK 内部会生成），
        // 这里只传业务字段，用 any 跨类型断言
        await namingClient.registerInstance(
          name,
          { ip, port, metadata } as any,
          groupName,
        );

        app.logger.info(
          `[vextjs-nacos] Service registered: ${name} (${ip}:${port}) → ${opts.serverAddr}`,
        );

        app.extend("nacos", {
          naming: namingClient,
          async discover(
            serviceName: string,
            discoverGroup: string = DEFAULT_GROUP,
          ): Promise<string> {
            const instances = await namingClient.selectInstances(
              serviceName,
              discoverGroup,
              undefined,  // clusters: 不指定（不要传 true，第3参是 clusters 字符串）
              true,       // healthy: 仅返回健康实例
            );
            if (!instances || instances.length === 0) {
              throw new Error(
                `[vextjs-nacos] No healthy instances for service: ${serviceName}`,
              );
            }
            const inst = instances[Math.floor(Math.random() * instances.length)];
            return `http://${inst.ip}:${inst.port}`;
          },
        });

        // 服务注销 onClose（最后注册 → LIFO 最先执行：先停流量）
        // NamingClient.close() 会释放心跳、订阅和 push receiver 资源。
        app.onClose(async () => {
          try {
            await namingClient.deregisterInstance(
              name,
              { ip, port } as any,
              groupName,
            );
            app.logger.info(
              `[vextjs-nacos] Service deregistered: ${name} (${ip}:${port})`,
            );
          } catch (err) {
            app.logger.warn(
              `[vextjs-nacos] Deregister failed: ${(err as Error).message}`,
            );
          } finally {
            try {
              await namingClient.close();
              app.logger.debug("[vextjs-nacos] Naming client closed");
            } catch (err) {
              app.logger.warn(
                `[vextjs-nacos] Naming client close failed: ${(err as Error).message}`,
              );
            }
          }
        });
      }
    },
  });
}

// 默认导出
export default nacosPlugin;

