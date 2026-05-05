# 2026-05-08 — 浏览即缓存 (Issue #14) 落地

> 关联 RFC：[`docs/browse-as-cache-design.md`](../browse-as-cache-design.md)
> 关联 Issue：[#14](https://github.com/gaopengbin/geo-downloader/issues/14)

## 摘要

按 6 个阶段把「浏览即缓存 + MBTiles/GPKG 导出」从 RFC 推到主线可用，主线全部 21 个单元测试通过（含本次新增 7 个）。`cargo check --manifest-path src-tauri/Cargo.toml` 与 `npm --prefix frontend run build` 均干净。

## 阶段交付

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | `tile_cache::Store` (rusqlite + WAL + LRU 连接池) | done |
| 2 | 前端 `createCachedTileLayer` + 设置面板「瓦片缓存」分组 | done |
| 3 | downloader/wayback/streaming_tiff 三条流水接入 cache.get/put | done |
| 4 | `tile_pack::append_zoom_to_mbtiles`（TMS row）+ `execute_zoom_level` 分支 | done |
| 5 | `tile_pack::append_zoom_to_gpkg`（XYZ row + GPKG 元表三件套） | done |
| 6 | 自定义 URI scheme `gdcache://`（Win 上为 `http://gdcache.localhost`） | done |

## 与 RFC 的关键差异

1. **gdcache scheme 提前到主线**（RFC 列为「演进」）：免 base64，零 JS round-trip，跨平台前缀通过 UA sniff 处理。
2. **导出 writer 独立成 `tile_pack.rs`**（RFC 设计在 `exporter.rs` 内）：导出器只处理 RGB/RGBA 拼接，瓦片包写入与拼接耦合度低；新加的 `ExportFormat::Mbtiles | ExportFormat::Gpkg` 在 4 个 `export_*` 函数中显式 `Err("MBTiles/GPKG 不走 RGB/RGBA 拼接路径")`。
3. **MBTiles 复制策略改写**：放弃跨库 `INSERT … SELECT`，改在 `execute_zoom_level` 完成一个 zoom 后把已写文件目录批量灌入 mbtiles，复用现成的 retry/限速/进度逻辑。
4. **缓存目录命名**：`<sha8>__<slug>.mbtiles`，slug 仅作辨识，sha 防重名。

## 测试新增

- `tile_cache::tests::parse_gdcache_uri_basic`（5 case：标准、`http://gdcache.localhost`、扩展名、query/fragment、percent-encoded）
- `tile_cache::tests::parse_gdcache_uri_invalid`（5 case：段数不足/非数字/非 URI）
- `tile_pack::tests::mbtiles_writes_metadata_and_tiles_with_tms_row`（XYZ y=0 z=2 → TMS row=3）
- `tile_pack::tests::mbtiles_appending_zoom_updates_min_max`
- `tile_pack::tests::gpkg_creates_required_tables_and_xyz_row`（application_id=1196444487, user_version=10300）
- `tile_pack::tests::detect_tile_format_recognizes_png_jpg_webp`
- `tile_pack::tests::lonlat_bbox_to_mercator_global`

## 中途排错记录

| 现象 | 根因 | 修法 |
|---|---|---|
| `multi_replace_string_in_file` 把不同文件相似 oldString 拼接成 `()ig::allow_invalid_certs()` 等乱码 | 跨文件同形替换工具 bug | 拆成 per-file 单次 replace；批后立刻 `cargo check` |
| ExportFormat 非穷尽 match 编译错误 | 新增 `Mbtiles`/`Gpkg` 后 4 个 export 函数缺臂 | 显式返回 `Err(...)` |
| `source` 被 move 后再借 | `TileDownloader::new(source, ...)` 拿走所有权 | `source.clone()` |
| 前两个 mbtiles 测试 minzoom 期望 2 实际 0 | `open_mbtiles` 用 `meta.min_zoom` 初始化（sample 给的是 0），`append_zoom_to_mbtiles` 再 `min(cur, current_zoom)` 合并，0 永远赢 | 测试里手动把 `meta.min_zoom`/`max_zoom` 对齐首个 append zoom（这也是真实调用方的写法） |
| WebView2 `window.confirm()` 非阻塞 | Tauri 2.0 已知行为 | 改用 `await window.__TAURI__.dialog.ask()` |
| Tauri scheme 在 Windows/Android 暴露为 `http://<scheme>.localhost` | 平台差异 | 前端 UA sniff 拼前缀，CSP 同时放行 `gdcache:` 与 `http://gdcache.localhost` |

## 待办（下一里程碑）

1. 手测：同区域两次下载 → `cache_stats` 对比，验收「网络请求 ≤ 30%」指标。
2. 手测：QGIS / mbview 打开实际产物。
3. 缓存目录切换 + 旧目录搬迁 UI（RFC §6.3）首版未做。
4. MBTiles「完整模式」导出（bbox 边缘缓冲）首版未做。
5. 矢量切片缓存挂在 Issue #8 落地后复用同一 Store。

## 关键文件

- 后端：`src-tauri/src/tile_cache/{mod,store,pool}.rs`、`src-tauri/src/tile_pack.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/commands.rs`、`src-tauri/src/exporter.rs`
- 前端：`frontend/src/features/map/cached-tile-layer.ts`、`frontend/src/features/settings/cache-section.tsx`
- 配置：`src-tauri/tauri.conf.json`（CSP img-src）
- 文档：`docs/browse-as-cache-design.md`（已加 §12 实现状态）
