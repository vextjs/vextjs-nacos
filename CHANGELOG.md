# Changelog

All notable changes to `vextjs-nacos` will be documented in this file.

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

