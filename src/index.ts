/**
 * vextjs-nacos — VextJS 官方 Nacos 集成插件
 *
 * 功能：
 *   - 服务注册与发现（NacosNamingClient）
 *   - 动态配置中心（NacosConfigClient）
 *   - 完整 TypeScript 类型增强（VextApp.nacos / VextApp.remoteConfig / VextConfig.nacos）
 *
 * 用法：
 *   // src/plugins/nacos.ts
 *   import { nacosPlugin } from "vextjs-nacos";
 *   export default nacosPlugin();   // 读取 vext.config.ts 中的 nacos 配置
 *
 *   // 或显式传参：
 *   export default nacosPlugin({
 *     serverAddr: "127.0.0.1:8848",
 *     service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
 *     config: { dataId: "order-service", group: "DEFAULT_GROUP" },
 *   });
 *
 * @module vextjs-nacos
 */

import { NacosNamingClient, NacosConfigClient } from "nacos";
import { definePlugin } from "vextjs";
import type { VextApp } from "vextjs";

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
  /** Nacos 服务器地址，如 "127.0.0.1:8848" */
  serverAddr: string;
  /** 命名空间，默认 "public" */
  namespace?: string;
  /** Nacos 鉴权用户名（开启鉴权的 Nacos 必填）*/
  username?: string;
  /** Nacos 鉴权密码（开启鉴权的 Nacos 必填）*/
  password?: string;
  /** 服务注册配置（缺省则不注册当前服务）*/
  service?: NacosServiceOptions;
  /** 配置中心配置（缺省则不订阅配置）*/
  config?: NacosConfigOptions;
}

export interface NacosExtension {
  /** NacosNamingClient 原生实例，可直接调用 SDK 全部 API */
  naming: NacosNamingClient;
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
    remoteConfig?: Record<string, unknown>;
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
function createNacosLogger(app: VextApp) {
  return {
    info(msg: string)  { app.logger.debug({ source: "nacos" }, msg); },
    warn(msg: string)  { app.logger.warn({ source: "nacos" }, msg);  },
    error(msg: string) { app.logger.error({ source: "nacos" }, msg); },
    debug(msg: string) { app.logger.debug({ source: "nacos" }, msg); },
    log(msg: string)   { app.logger.debug({ source: "nacos" }, msg); },
  };
}

// nacos SDK 的 Instance 类型要求 instanceId 必填且不含 metadata 字段，
// 实际 SDK 内部会自动生成 instanceId，业务调用时只需传 ip/port/metadata。
// register/deregister 调用处使用 `as any` 局部断言。

const DEFAULT_GROUP = "DEFAULT_GROUP";
const DEFAULT_NAMESPACE = "public";

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

      if (!opts.serverAddr) {
        app.logger.warn("[vextjs-nacos] serverAddr missing, plugin disabled");
        return;
      }

      const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
      const logger = createNacosLogger(app);

      // ⚠️ LIFO 顺序设计：
      //   先处理 config（先注册 config.close onClose → LIFO 后执行）
      //   再处理 service（后注册 deregister onClose → LIFO 先执行：先停流量）
      // 这样保证关闭时：先 deregister（停流量）→ 再 config.close

      // ── 2. 配置中心（config 配置存在时，先处理）─────────
      if (opts.config) {
        const { dataId, group } = opts.config;
        const cGroup = group ?? DEFAULT_GROUP;

        const configClient = new NacosConfigClient({
          serverAddr: opts.serverAddr,   // ⚠️ ConfigClient 字段名是 serverAddr（与 NamingClient 不同）
          namespace,
          username: opts.username,
          password: opts.password,
        });
        // ❌ NacosConfigClient 在 nacos@2.6.1 中没有 ready() 方法

        // 拉取初始配置
        try {
          const raw = await configClient.getConfig(dataId, cGroup);
          if (raw) {
            try {
              app.extend("remoteConfig", JSON.parse(raw));
              app.logger.info(`[vextjs-nacos] Remote config loaded: ${dataId}@${cGroup}`);
            } catch {
              app.logger.warn(
                `[vextjs-nacos] Initial config parse failed (not JSON): ${dataId}`,
              );
            }
          }
        } catch (err) {
          app.logger.warn(
            `[vextjs-nacos] Initial config fetch failed: ${(err as Error).message}`,
          );
        }

        // 监听变更
        configClient.subscribe({ dataId, group: cGroup }, (content: unknown) => {
          if (typeof content !== "string") return;
          try {
            app.extend("remoteConfig", JSON.parse(content));
            app.logger.info(`[vextjs-nacos] Remote config updated: ${dataId}@${cGroup}`);
          } catch {
            app.logger.warn(
              `[vextjs-nacos] Updated config parse failed (not JSON): ${dataId}`,
            );
          }
        });

        // 配置客户端关闭 onClose（先注册 → LIFO 后执行）
        app.onClose(async () => {
          try {
            configClient.close();
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
        // 注意：NacosNamingClient 在 nacos@2.6.1 中没有 close() 方法，仅注销实例
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
          }
        });
      }
    },
  });
}

// 默认导出
export default nacosPlugin;

