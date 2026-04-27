# 2026-04-25 Wayback v3.4.0-beta.1 与更新检查记录

## 状态

- 关联版本：`v3.4.0-beta.1`
- 关联提交：`831df7c feat(wayback): 服务级聚合 + 极速/精细模式 + 错误链优化 (#13)`
- Release：`https://github.com/gaopengbin/geo-downloader/releases/tag/v3.4.0-beta.1`
- 构建状态：GitHub Actions 已成功上传 Windows/Linux/macOS 产物，Release 标记为 prerelease。

## Wayback 扫描语义调整

本轮确认“拍摄日期仍是主要语义”，但下载执行粒度保持 Wayback release，因为 Esri Wayback 的瓦片 URL 本质上是 release 级全球马赛克快照，单个瓦片不带拍摄日期。

当前实现采用“服务级聚合 + 拍摄日期主导信息”的折中方案：

- `WaybackScanResult` 同时保留：
  - `footprints`：兼容旧的拍摄 footprint 去重列表
  - `releases`：新增 release 级摘要列表
- `ReleaseSummary` 每个 release 一行，包含：
  - `dominant_capture_date`：当前 bbox 内占比最高的拍摄日期
  - `dominant_ratio`：主导日期面积 / release 内有数据面积
  - `coverage_ratio`：release 在用户 bbox 内的覆盖比例
  - `captures`：该 release 内各拍摄日期的占比分布
- 面积估算采用 footprint geometry bbox 与用户 bbox 的相交面积（degree²）近似，不做真实多边形求交。

## 扫描模式

`scan_wayback_metadata` 新增 `scan_mode`：

- `fast`：默认，仅查询 `zoom_max` 对应的单 metadata layer，约减少 3 倍请求量。
- `fine`：查询 `select_layers(zoom_min, zoom_max)` 返回的多 layer，面积分布更细，但更慢。

前端在“按拍摄日期”模式中提供“极速 / 精细”切换。

## 鲁棒性修复

`src-tauri/src/wayback_metadata.rs`：

- 新增 `QueryError` 分类：
  - `Network`：DNS/connect/timeout/TLS/RST 等网络错误，可重试
  - `UpstreamServerError`：HTTP 5xx，上游服务故障，不重试
  - `Other`：4xx / JSON 解析等，不重试
- 新增 `format_reqwest_error()`，展开 `reqwest::Error` source 链，避免日志只显示 `error sending request for url`。
- 扫描期间维护 `dead_services: Arc<Mutex<HashSet<String>>>`，某个 metadata MapServer 首次 5xx 后直接拉黑该服务，后续 layer 短路跳过。
- `QUERY_MAX_RETRIES = 4`，`RETRY_BACKOFF_BASE_MS = 1500`，仅网络错误进入指数退避。
- `SCAN_CONCURRENCY = 8`，配合 dead service 保护恢复扫描速度。

## 进度与缓存

- `commands.rs` 在后台扫描前调用 `insert_placeholder_progress()`，避免 `fetch_releases_raw()` 期间前端轮询拿到 `None` 后误判扫描结束。
- `wayback.rs::fetch_releases_raw()` 增加 1 小时进程内缓存，避免重复扫描时反复请求 `waybackconfig.json`。
- metadata 扫描结果仍使用 7 天本地文件缓存。
- 2026-04-25 续修：metadata 文件缓存 key 已纳入 `scan_mode`，避免 `fast` / `fine` 模式互相命中陈旧结果；`WaybackScanResult` 同步记录生成该结果时的 `scan_mode`。

## 前端改动

- `static/index.html`：按拍摄日期面板新增极速/精细 segmented 开关、结果说明卡、主导占比/覆盖率筛选。
- `static/css/style.css`：新增 `.wayback-mode-switch`、`.wayback-result-list`、`.wayback-release-item`、`.wayback-result-help`，颜色使用主题变量。
- `static/js/app.js`：
  - 使用 `waybackScanReleases` 渲染 release 级列表。
  - 列表显示主导拍摄日期、source、分辨率、release 日期、主导占比、覆盖率。
  - tooltip 展示 top 拍摄日期分布。
  - 仍通过 `download_wayback_incremental` 复用现有 release 下载链路。

## Release 与自动更新

- `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 升至 `3.4.0-beta.1`。
- `.github/workflows/release.yml` 支持根据版本号是否含 `-` 自动设置 GitHub Release `prerelease: true`。
- 当前未提交改动：`static/js/app.js` 中更新检查逻辑已调整为：
  - 稳定版用户：请求 `/releases/latest`，不被 beta 打扰。
  - prerelease 用户：请求 `/releases?per_page=5`，可看到后续 beta/rc，也能在正式版发布后升级到稳定版。
  - `compareVersions()` 已改为 SemVer 比较，正确处理 `3.4.0 > 3.4.0-beta.1 > 3.3.0`。

## 待注意

- `docs/wayback-incremental-design.md` 仍是初版设计，未完全反映服务级聚合方案。
- `wayback_metadata.rs` 顶部注释仍偏旧，仍强调“按拍摄日期+几何去重”，后续可改成“双轨输出：footprint 兼容 + release 聚合”。

## mem0 项目隔离约定

当前仓库的 mem0 项目记忆使用以下固定标识：

```text
app_id = geo-downloader
agent_id = copilot-vscode
repo = gaopengbin/geo-downloader
workspace = g:/code/tif-downloader
```

写入和检索项目级事实时必须带 `app_id=geo-downloader`，避免与 OpenClaw、Unreal MCP 等其他项目记忆串味。token 只作为认证凭据，不承担项目隔离职责；项目隔离靠 `app_id` / `repo` / `workspace` 维度完成。

本轮已写入的项目级记忆种子：

- 当前仓库项目标识与检索约定。
- 不自动 commit / push 的仓库协作规则，以及 `v3.4.0-beta.1` 对应提交。
- Wayback 当前采用 `footprints + releases` 双轨扫描结果，前端优先使用 `ReleaseSummary`。
- Wayback metadata 缓存 key 未包含 `scan_mode` 的风险；本轮续修后已纳入 `scan_mode`，后续记忆应以“已修复”为准。
