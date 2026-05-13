# Changelog

All notable changes to `vextjs-nacos` will be documented in this file.

## [Unreleased]

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

