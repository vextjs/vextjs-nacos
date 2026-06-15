# Changelog

All notable changes to `vextjs-nacos` will be documented in this file.

## [Unreleased]

暂无。

## [0.2.8] — 2026-06-15

### 修复

- **动态配置更新**：修复 Nacos 订阅收到合法 JSON object 后重复调用 `app.extend("remoteConfig")` 被 VextJS 覆盖保护拒绝的问题；后续更新会原地刷新稳定的 `app.remoteConfig` 引用。
- **告警准确性**：订阅更新时区分配置解析失败与远程配置同步失败，避免把非解析异常误报为 `Updated config parse failed (not JSON object)`。
- **验证依赖安全**：开发验证基线同步到 `vextjs@0.3.26`，并通过 npm overrides 固定 `esbuild@0.28.1` 以规避 dev 工具链高危 audit。

## [0.2.7] — 2026-06-11

### 变更

- **启动轻量化**：包入口移除 `nacos` SDK 顶层 runtime import，`enabled:false`、无 `serverAddr`、无 config/service 时不创建 SDK client。
- **懒加载保持兼容**：真实 config/service/bootstrap `load()` 路径仍动态导入官方 `NacosConfigClient` / `NacosNamingClient`，关闭和注销逻辑保持不变。
- **验证基线更新**：开发验证依赖同步到 `vextjs@0.3.24` 与 `vitest@3.2.6`，并通过 `npm audit --audit-level=high`。

## [0.2.6] — 2026-06-09

### 变更

- **依赖固定**：将 `package.json` 中 direct runtime 与 dev dependencies 固定为 `package-lock.json` 已解析精确版本，降低消费者安装时的依赖漂移风险。
- **兼容性边界**：保留 `peerDependencies.vextjs >=0.3.4` 兼容范围，仅将开发依赖 `vextjs` 固定为本仓库验证基线。

## [0.2.3] — 2026-05-13

### 变更

- **兼容性基线**：将 `vextjs` 的最低兼容版本提升到 `>= 0.3.4`，与已发布的 `vextjs@0.3.4` 基线保持一致
- **发布元数据**：同步 README、包元数据与发布日志，明确常规消费场景直接使用 npm semver 即可，不需要本地 link

## [0.2.1] — 2026-04-28

### 修复

- **发布兼容性**：补齐 `package.json` 的 `exports.require` 与 `main` CJS 入口，修复消费项目在 `bootstrap.ts` / CJS 加载链路下无法根导入 `vextjs-nacos` 的问题
- **构建产物一致性**：将构建改为同时生成 ESM `dist/index.js` 与 CJS `dist/index.cjs`，确保 `createNacosBootstrapProvider()` 等最新导出在两个入口中保持一致

### 新增

- **bootstrap config provider helper**：新增 `createNacosBootstrapProvider()`，支持在 Vext 配置冻结前从 Nacos 拉取启动期配置 patch
- **多配置拉取**：`nacosPlugin()` 与 bootstrap helper 均支持 `config + configs` 双轨声明，按声明顺序深合并、后者优先

### 变更

- **兼容性**：bootstrap helper 依赖 Vext bootstrap provider 能力，最低 `vextjs` 版本提升到 `>= 0.3.2`

## [0.1.0] — 2026-04-27

🎉 首次发布

### 新增

- **服务注册与发现**：`nacosPlugin()` 自动注册当前服务到 Nacos
  - `app.nacos.discover(serviceName, group?)` — 随机负载均衡，仅返回健康实例
  - `app.nacos.naming` — 暴露 `NacosNamingClient` 原生实例
- **动态配置管理**：从 Nacos 配置中心拉取并订阅
  - `app.remoteConfig` — 解析后的 JSON 对象，配置变更时自动更新
- **TypeScript 类型增强**：内联 `declare module "vextjs"`，零额外配置即享受完整类型提示
- **优雅关闭**：应用关闭时按 LIFO 自动 `deregisterInstance` + `configClient.close`

### 兼容性

- Node.js >= 18
- vextjs >= 0.2.0（peerDependency, optional）
- nacos ^2.6.1

