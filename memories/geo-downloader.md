# geo-downloader — 项目核心层记忆

> 高频上下文。每次新会话开工前必读。≤ 200 行，超量沉到 mem0。
> 通用规则见 [`_rules.md`](./_rules.md)。

## 项目标识

- 仓库：`gaopengbin/geo-downloader`
- 工作区：`g:/code/tif-downloader`
- 产品名：GeoDownloader（原 tif-downloader，v3.0.0 更名）
- 当前发布：v3.4.4（稳定）
- mem0：`app_id=geo-downloader`、`agent_id=copilot-vscode`、`userId=mem0-mcp`

## 技术栈速记

- 后端：Rust + Tauri 2.x（`src-tauri/`）
- 前端：React 19 + Vite 8 + TypeScript + shadcn/ui (new-york) + Tailwind v4 + Zustand + TanStack Query（`frontend/`）
- 地图：Leaflet 2.x + leaflet-draw + MapLibre GL（含 `@maplibre/maplibre-gl-leaflet` 桥接）+ Cesium 1.140
- 数据：GDAL（可选 feature `geotiff`）、`tiff`/`png`/`image` crate、`rusqlite`（MBTiles/GPKG/瓦片缓存）
- 官网：`site/`（Cloudflare Pages，手动 wrangler 部署，**不联动 git push**）

## 启动 / 构建

```powershell
# 开发模式（React 前端 + Tauri 后端）
npm ci --prefix frontend
cargo tauri dev --manifest-path src-tauri/Cargo.toml --config src-tauri/tauri.react.conf.json

# 仅前端
npm --prefix frontend run build

# 仅 Rust 后端语法检查
cargo check --manifest-path src-tauri/Cargo.toml

# 发布构建
cargo tauri build --manifest-path src-tauri/Cargo.toml

# 官网部署（不会自动触发）
npx --yes wrangler@latest pages deploy site --project-name=geodownloader --branch=main
```

## 协作红线

- **不自动 commit / push**：用户明确说"提交" / "推送"才执行
- 改 Rust 必跑 `cargo check`；改前端必跑 `npm run build`
- 改完代码必检查 VS Code Problems / `get_errors` 输出
- 不写入密钥 / Token / API Key 到记忆或代码
- 不删 `static/`（旧前端 fallback，保留至 React 版 QA 通过）
- 跨分支搬单文件用 `git checkout <src-branch> -- <file>`，不要 `git stash`

## 已知踩坑（每次都要警惕）

- **Tailwind v4 字号 cascade**：顶层 `button, input, select, textarea { font: inherit }` 会覆盖 `text-xs/sm` 工具类。必须用 `font-family: inherit` 且整体包入 `@layer base`
- **TIFF LZW 编码**：用 `weezl::Encoder::with_tiff_size_switch`（不是 `new`），否则 libtiff 解码失败
- **BigTIFF inline 存储**：≤ 8 字节的 tag 必须 inline，不能写外部 offset，否则 GDAL/QGIS 读不开
- **WebView2 `window.confirm()` 非阻塞**：必须 `await window.__TAURI__.dialog.ask()`，否则代码继续执行
- **Tauri `convertFileSrc` 在 Windows**：会把 `\` 编码为 `%5C`，破坏相对路径解析。3D Tiles 必须走本地 HTTP 服务 `serve_local_tiles`
- **Leaflet z-index 200-800**：`.leaflet-container { isolation: isolate }` 否则 Dialog 蒙层被盖
- **QGIS 中文路径打不开 mbtiles/gpkg**：Windows narrow `fopen` + UTF-8 字节导致。对 sqlite 类输出用 ASCII id 命名（`tianditu_satellite_z11.mbtiles`）
- **`multi_replace_string_in_file` 同形替换 bug**：跨文件相似 oldString 会拼接成乱码。必须 per-file 单次 replace + 立即 `cargo check`
- **PowerShell UTF-8 输出**：执行 `gh` 等输出中文的命令前先 `$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 > $null`
- **`gh api -f` 类型**：sub-issues 等需要整数参数时必须用 `-F`，`-f` 总是字符串会 422

## 关键路径

- 命令入口：`src-tauri/src/commands.rs`（130 KB）
- 配置 + 内置图源：`src-tauri/src/config.rs`
- 下载链路：`downloader.rs` → `merger.rs` / `streaming_tiff.rs` → `exporter.rs` / `tile_pack.rs`
- 瓦片缓存：`src-tauri/src/tile_cache/` + 自定义 scheme `gdcache://`（Win 上 `http://gdcache.localhost`）
- 前端入口：`frontend/src/App.tsx`
- 模式分页：`frontend/src/features/{imagery,vector,mvt,tiles3d,wayback,dem,region,batch,...}`
- 共享输出控件：`frontend/src/features/download/output-controls.tsx`
- 工作记录：`docs/worklog/YYYY-MM-DD-<topic>.md`

## Wayback 专项

- 官方瓦片入口：`https://wayback-a.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/tile/...`（与 Living Atlas 官网同源）
- 直连失败再代理兜底，预览图层用 `referrerPolicy=no-referrer`
- 扫描双轨：`footprints`（旧）+ `releases`（新，含 `dominant_capture_date` / `coverage_ratio`）
- metadata 文件缓存 7 天，cache key 已纳入 `scan_mode`

## 待办索引（详情见 docs/worklog）

| 来源 | 内容 | 优先级 |
|---|---|---|
| #22 | 输出目录不生效（用户已让试新版） | 待复现 |
| #24 | zustand persist 启动恢复（图源 / 选区 / 视角） | enhancement |
| #25 | 换格式重导出走完整下载循环，缓存命中应批量预过滤 | perf bug |
| #26 | 缓存命中绕过 `temp_dir`，bytes 直接交 merger | perf |
| #27 | 多 strip 并行解码 + 大内存缓冲提速大区导出 | perf |
| #28 | 浏览期间新缓存的瓦片从待下载矩阵动态剔除 | enhancement |
| #29 | Sentinel-2 / Landsat 集成（v3.5 规划，STAC + COG） | enhancement |
| #30 | 下载预估偏低 17x，需重新设计估算公式 | bug |
| #31 | 部分失败任务的导出策略：自动导出 + 缺块徽章 + 阈值 + 补漏 | enhancement |
| worklog 05-08 | 3D Tiles 末段卡死（`resolve_and_stream` 无 `tokio::time::timeout`） | 待复现日志 |
| worklog 05-07 | MVT mbtiles/gpkg 在 QGIS 看不到图层（缺 `vector_layers` JSON metadata） | bug |
| worklog 04-17 | exporter OOM（C3/C4，`Vec` 聚合未流式） | 单独 RFC |

## 历史决策摘要

- **C5/C6 XSS**：`escapeHtml` + `escapeAttr` + `data-*` + `addEventListener` 取代内联 `onclick`
- **TLS 验证**：`config::ALLOW_INVALID_CERTS` 原子量 + `settings.allow_invalid_certs`，默认严格
- **tile.rs 溢出**：`MAX_ZOOM=24` + `clamp_zoom` + u64 中间量 + `saturating_*`
- **DEM 输出**：Float32 BigTIFF + EPSG:4326 + GDAL_NODATA=-9999.0；仅 Terrarium 单源（v3.5 候选 Mapbox / Copernicus / SRTM）
- **browse-as-cache (#14)**：`tile_cache::Store`（rusqlite + WAL + LRU 池）+ `RunEvent::Exit` checkpoint + `gdcache://` scheme
- **KML / KMZ**：客户端 JS 解析（`@tmcw/togeojson` + `jszip`），与 Shapefile `shpjs` 路径一致
- **Wayback 缩放级别**：chip 多选（与 imagery 对齐），后端 `zoom_levels: Option<Vec<u8>>`
- **矩形选区裁剪**：默认开启，复用 `crop_to_shape`（GeoTIFF / PNG，JPEG 不启用避免黑边）
