# vextjs-nacos

> VextJS 官方 Nacos 集成插件 — 服务注册/发现 + 动态配置管理 + bootstrap config provider helper

[![npm](https://img.shields.io/npm/v/vextjs-nacos.svg)](https://www.npmjs.com/package/vextjs-nacos)
[![License](https://img.shields.io/npm/l/vextjs-nacos.svg)](./LICENSE)

## 特性

- ✅ **服务注册**：应用启动时自动向 Nacos 注册当前服务实例
- ✅ **服务发现**：`app.nacos.discover(serviceName)` 一行获取健康实例
- ✅ **动态配置**：从 Nacos 配置中心拉取并订阅配置变更，自动更新 `app.remoteConfig`
- ✅ **启动期配置**：`createNacosBootstrapProvider()` 可在配置冻结前从 Nacos 拉取并合并远程配置
- ✅ **多配置合并**：支持 `config + configs` 双轨声明，按顺序深合并、后者优先
- ✅ **优雅关闭**：应用关闭时按 LIFO 顺序自动注销实例并关闭客户端
- ✅ **完整类型**：通过 `declare module "vextjs"` 自动增强 `VextApp` / `VextConfig` 类型

## 兼容性

| 依赖 | 版本 |
|------|------|
| Node.js | `>= 18` |
| vextjs | `>= 0.3.2`（peerDependency, optional）|
| nacos | `^2.6.1`（已实测）|

## 安装

```bash
npm install vextjs-nacos
```

## 快速开始

### 1. 配置（`vext.config.ts` / `src/config/default.ts`）

```typescript
import type { VextConfig } from "vextjs";

export default {
  port: 3000,
  adapter: "native",

  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
    namespace: process.env.NACOS_NAMESPACE ?? "public",
    // 开启鉴权的 Nacos（2.x 默认开启）必填
    username: process.env.NACOS_USERNAME,
    password: process.env.NACOS_PASSWORD,
      
    service: {
      name: "order-service",
      group: "DEFAULT_GROUP",
      ip: process.env.SERVICE_IP ?? "127.0.0.1",
      port: 3000,
      metadata: { version: "1.0.0" },
    },

    config: {
      dataId: "order-service",
      group: "DEFAULT_GROUP",
    },

    configs: [
      { dataId: "order-service-base", group: "DEFAULT_GROUP" },
      { dataId: "order-service-prod", group: "DEFAULT_GROUP" },
    ],
  },
} satisfies VextConfig;
```

> `config` 与 `configs` 可以同时存在：插件会按 `config` → `configs[0]` → `configs[1]` 的顺序深合并；后者覆盖前者同名字段，数组整体覆盖。

### 2. 注册插件（src/plugins/nacos.ts）

```typescript
import { nacosPlugin } from "vextjs-nacos";

// 自动读取 vext.config.ts 中的 nacos 配置
export default nacosPlugin();
```

或显式传参（覆盖 `vext.config.ts`）：

```typescript
import { nacosPlugin } from "vextjs-nacos";

export default nacosPlugin({
  serverAddr: "127.0.0.1:8848",
  service: { name: "order-service", ip: "127.0.0.1", port: 3000 },
});
```

### 3. 使用服务发现

```typescript
// src/services/user.ts
export class UserService {
  constructor(private app: any) {}

  async getUser(userId: string) {
    // 通过 Nacos 发现 user-service
    const baseURL = await this.app.nacos!.discover("user-service");

    // 用 vext 内置 fetch 调用（自动传播 requestId）
    const response = await this.app.fetch.get(`${baseURL}/api/users/${userId}`);

    if (!response.ok) {
      // ⚠️ Service 层不处理 HTTP 状态码，抛业务错误让框架统一转换
      throw new Error(`Failed to fetch user: ${userId} (status ${response.status})`);
    }

    return response.json();
  }
}
```

### 4. 使用远程配置

```typescript
// src/routes/features.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/features/:key", {
    validate: { param: { key: "string!" } },
  }, async (req, res) => {
    const { key } = req.valid("param");
    const features = (app.remoteConfig?.features ?? {}) as Record<string, boolean>;
    res.json({ feature: key, enabled: features[key] ?? false });
  });
});
```

### 5. 启动期远程配置（bootstrap provider）

当数据库、密钥或基础设施配置必须在插件初始化前生效时，请使用 `createNacosBootstrapProvider()`：

```typescript
// src/config/bootstrap.ts
import { defineBootstrapConfig } from "vextjs";
import { createNacosBootstrapProvider } from "vextjs-nacos";

export default defineBootstrapConfig({
  providers: [
    createNacosBootstrapProvider({
      name: "admin-nacos-bootstrap",
      serverAddr: process.env.NACOS_SERVER_ADDR ?? "127.0.0.1:8848",
      namespace: process.env.NACOS_NAMESPACE ?? "public",
      username: process.env.NACOS_USERNAME,
      password: process.env.NACOS_PASSWORD,
      configs: [
        { dataId: "config.json", group: "admin-service" },
        { dataId: "database.json", group: "admin-service" },
      ],
    }),
  ],
});
```

该 helper 只负责**启动期批量拉取并合并 JSON 对象 patch**，不会执行服务注册、`app.nacos` 挂载或 `app.remoteConfig` 订阅；这些运行期能力仍由 `nacosPlugin()` 负责。

## API

### `nacosPlugin(options?)`

工厂函数，返回符合 vext `VextPlugin` 接口的插件实例。

**参数**：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|:----:|------|------|
| `serverAddr` | `string` | ✅ | — | Nacos 服务器地址，如 `"127.0.0.1:8848"` |
| `namespace` | `string` | — | `"public"` | 命名空间 |
| `service` | `NacosServiceOptions` | — | — | 服务注册（缺省则不注册）|
| `config` | `NacosConfigOptions` | — | — | 单个配置中心配置 |
| `configs` | `NacosConfigOptions[]` | — | — | 多个配置中心配置，按声明顺序深合并、后者优先 |

> 选项与 `app.config.nacos` 合并，**显式参数优先**。

### `app.nacos.discover(serviceName, group?)`

服务发现，仅返回健康实例（已过滤 unhealthy）。

```typescript
const baseURL = await app.nacos!.discover("user-service");
// → "http://10.0.0.5:3000"
```

随机负载均衡。如需权重/一致性哈希，请直接使用 `app.nacos!.naming.selectInstances(...)`。

### `app.remoteConfig`

来自 Nacos 配置中心的远程配置（解析后的 JSON 对象）。配置变更时自动更新。

```typescript
const features = app.remoteConfig?.features ?? {};
```

> Nacos 配置内容需为合法 JSON 对象。非 JSON 对象内容会触发 warn 日志并保留上一版配置。

### `createNacosBootstrapProvider(options)`

返回符合 Vext `BootstrapConfigProvider` 契约的 provider，可直接放入 `src/config/bootstrap.ts`。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|:----:|------|------|
| `name` | `string` | — | `nacos-bootstrap-provider` | provider 名称 |
| `timeoutMs` | `number` | — | — | provider 超时（毫秒） |
| `required` | `boolean` | — | — | 是否必需，交由 Vext bootstrap provider 规则处理 |
| `serverAddr` | `string` | ✅ | — | Nacos 服务器地址 |
| `namespace` | `string` | — | `public` | 命名空间 |
| `username` | `string` | — | — | 鉴权用户名 |
| `password` | `string` | — | — | 鉴权密码 |
| `config` | `NacosConfigOptions` | — | — | 单个配置源 |
| `configs` | `NacosConfigOptions[]` | — | — | 多个配置源，按声明顺序深合并 |

> helper 期望每个 Nacos 配置内容都是 **JSON 对象**；空字符串会被视为“该来源无 patch”，数组会按 Vext config merge 规则整体覆盖。

## 优雅关闭

应用收到 `SIGTERM` / `SIGINT` 时，插件按 **LIFO** 顺序自动执行：

1. **先**调用 `deregisterInstance()`（停止接受新流量）
2. **再**调用 `configClient.close()`（关闭配置订阅）

> 注：`NacosNamingClient` 在 nacos@2.6.1 中**没有** `close()` 方法，仅注销实例即可（进程退出后底层连接自然释放）。

## 多环境部署

通过 namespace 隔离环境：

```bash
# 开发
NACOS_SERVER_ADDR=dev-nacos:8848 NACOS_NAMESPACE=dev node dist/index.js

# 生产
NACOS_SERVER_ADDR=prod-nacos:8848 NACOS_NAMESPACE=prod node dist/index.js
```

## 已知问题与设计决策

| 项 | 说明 |
|----|------|
| `NacosNamingClient.selectInstances` 第 3 参数 | 实际是 `clusters: string`，本插件已正确传入 `undefined` 跳过 |
| `NacosNamingClient` 无 `close()` | nacos SDK 设计如此，仅 `deregisterInstance()` 即可 |
| `NacosConfigClient` 无 `ready()` | nacos SDK 设计如此，构造后即可使用 |
| `NamingClient.serverList` vs `ConfigClient.serverAddr` | 两个子包字段名不同，本插件已统一封装为 `serverAddr` |
| bootstrap helper vs 普通插件 | helper 只处理启动期配置；运行期注册/发现/订阅仍使用 `nacosPlugin()` |

## 许可

MIT
