# 2026-05-06 mbtiles WAL 清理与 Wayback 代理预览修复

## 背景

同一用户反馈两个问题：

1. 切换/退出后缓存目录残留 `*.mbtiles-wal` / `*.mbtiles-shm`。
2. Wayback 历史影像在该用户机器上图层不加载、地图空白；开发者本地和其他设备可正常显示。

## mbtiles WAL 残留

### 根因

- 瓦片缓存使用 SQLite WAL 模式，但连接池在驱逐、清空、切换缓存目录和应用真正退出时没有显式 checkpoint/close。
- Tauri 窗口关闭按钮当前是最小化到托盘，不等于进程退出，因此仅依赖 drop 时机不可靠。

### 修复

- `src-tauri/src/tile_cache/store.rs`
  - 新增 `TileStore::checkpoint_and_close(self)`：执行 `PRAGMA wal_checkpoint(TRUNCATE)`，再切回 `journal_mode=DELETE`，最后显式 `close()`。
- `src-tauri/src/tile_cache/pool.rs`
  - LRU 驱逐、单 source 关闭、全局 shutdown 都走 checkpoint/close。
  - `clear(None)` 改为先 shutdown，避免删主库后留下孤儿 WAL。
- `src-tauri/src/tile_cache/mod.rs`
  - `set_root_dir` 切换目录前先 shutdown 旧连接。
- `src-tauri/src/lib.rs`
  - Tauri `RunEvent::Exit` 时调用 `tile_cache::Store::global().shutdown()`。

## Wayback 历史影像空白

### 根因判断

- Wayback 版本列表由后端 `get_wayback_versions(proxy)` 拉取，能使用应用代理。
- 但 Leaflet 瓦片预览原先直接把 `<img src>` 指向 `https://wayback.maptiles.arcgis.com/...`，这是 WebView2 直接请求，不经过 Tauri 后端 reqwest 代理。
- 进一步排查发现：有用户浏览器直连 Esri Wayback 官网可正常加载瓦片，因此不能简单地在应用代理开启时强制预览走代理；否则错误/过期代理会反过来造成超时。
- 对比 Living Atlas 官网网络面板后发现，官网实际瓦片入口是 `https://wayback-a.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/tile/...`，而 `waybackconfig.json` 中的 `itemURL` 仍是 WMTS 兼容路径。两者返回同一瓦片，但为降低 WebView2/CDN 调度差异，应用侧改为跟齐官网入口。
- 结论：Wayback 预览需要“官方入口直连优先、直连失败再代理兜底”，同时保留后端代理能力给确实无法直连的网络环境。

### 修复

- `src-tauri/src/commands.rs`
  - 扩展 `start_tile_proxy(base_url, headers, proxy)`，支持可选上游代理。
- `src-tauri/src/wayback.rs`
  - 后端下载任务和最大级别探测统一改用 Living Atlas 官网同款 `wayback-a.maptiles.arcgis.com/.../world_imagery/mapserver/tile` 入口。
  - 探测请求补齐 `Origin: https://livingatlas.arcgis.com` 与 `Referer: https://livingatlas.arcgis.com/`。
- `frontend/src/features/wayback/wayback-api.ts`
  - 集中定义 Wayback tile base URL，并改为 Living Atlas 官网同款 `wayback-a` 入口。
  - 新增 `buildWaybackTileUrl` 和 `startWaybackTileProxy(proxy)`。
  - 代理兜底请求补齐 `Origin` 与 `Referer`。
- `frontend/src/features/map/map-canvas.tsx`
  - Wayback 模式且应用代理开启时，先用浏览器 `Image` 加载低级别 Esri 瓦片探针。
  - 直连探针使用 `referrerPolicy=no-referrer`，避免向 Esri 发送本地 `127.0.0.1` Referer。
  - 若探针可直连，继续使用原始 Esri URL，避免被错误代理拖慢或超时。
  - 若探针失败/超时，再启动本地 `127.0.0.1` 反向代理并让图层请求本地反代 URL。
  - 缓存 metadata 的 `urlTemplate` 始终保留原始 Esri URL，避免写入临时端口。
  - 代理地址变化时重建对应图层，并重置当前底图 key，保证当前选中版本能重新挂载。
- `frontend/src/features/map/cached-tile-layer.ts`
  - 自定义缓存瓦片层补充透传 `referrerPolicy` 到实际 `<img>`，Wayback 直连图层使用 `no-referrer`。
- `frontend/src/features/tiles3d/tiles3d-api.ts`
  - `startTileProxy` 增加可选 proxy 参数，兼容后端命令签名。

## 验证

- `cargo check --quiet` 通过；Wayback 官方入口调整后再次通过。
- `npm run build` 通过；直连优先、官方入口、`no-referrer` 调整后均再次通过。
- VS Code Problems：相关文件与全工作区均无错误。

## 矩形选区裁剪与输出参数一致性

### 现象

- Wayback 预览恢复后，用户反馈框选下载结果似乎有轻微偏移。
- 排查确认后端瓦片坐标和 GeoTIFF 地理参考使用标准 Web Mercator；更可能的原因是矩形框选下载默认导出覆盖选区的完整瓦片矩阵，而不是按选区范围裁剪。
- 用户验证多边形裁剪后内容吻合，说明裁剪坐标参考和影像栅格本身对齐。

### 调整

- `frontend/src/features/download/crop-utils.ts`
  - 新增选区裁剪辅助函数，把矩形 `bounds` 转为后端已有 `crop_to_shape` 可消费的矩形 polygon。
- `frontend/src/features/imagery/imagery-page.tsx`
  - GeoTIFF / PNG 下载默认开启“按选区范围裁剪”。
  - 多边形选区继续按多边形裁剪；矩形选区自动按矩形范围裁剪，框外透明。
  - GeoTIFF 默认压缩方式调整为 LZW，与 Wayback 保持一致的通用兼容默认值。
  - 普通影像与 DEM 的路径按钮统一改为目录选择。选择目录后根据任务名称/默认任务名自动生成输出文件名；若用户手动输入完整文件路径则继续兼容。
- `frontend/src/features/wayback/wayback-page.tsx`
  - Wayback GeoTIFF / PNG 下载默认开启“按选区范围裁剪”，矩形框选不再退化为完整瓦片矩阵导出。
  - 输出参数补齐“构建影像金字塔”选项，并与普通影像下载使用一致的 TIFF 压缩选项文案。
  - Wayback 导出区补齐任务名称、保存路径/保存目录输入：单个模式显示文件路径，批量/增量模式显示目录，避免仍通过下载按钮临时弹框完成输出参数设置。
  - 单个和批量任务使用自定义任务名称；增量任务使用自定义任务名前缀。
  - 进一步调整路径选择按钮：Wayback 统一打开目录选择框。单个模式在目录下自动生成文件名，同时兼容用户手动输入完整文件路径；批量/增量继续按日期生成多个文件。
  - 单个下载按钮改为整行宽度，与批量/增量按钮和普通下载页的主操作按钮保持一致。
- `frontend/src/features/download/output-controls.tsx`
  - 抽出共享输出控件：TIFF 压缩、影像金字塔、选区范围裁剪开关。
  - 普通影像与 Wayback 复用同一套控件，避免后续文案和默认行为再次分叉。
- `src-tauri/src/commands.rs` / `frontend/src/types/api.ts`
  - Wayback 增量下载请求新增可选 `task_name_prefix`，用于让增量任务名称也能跟随导出区的自定义任务名。
- `frontend/src/features/tiles3d/tiles3d-page.tsx`
  - 补齐 3D Tiles 输出参数区：任务名称、保存目录。
  - 保存目录可预填/手动修改；下载时仍自动创建唯一子目录，避免覆盖已有模型目录。
- `frontend/src/features/vector/vector-panel.tsx`
  - OSM 下载补齐任务名称输入，留空时继续自动生成 `OSM <要素类型>`。

### 边界

- 当前“按选区范围裁剪”复用现有流式透明掩码路径，适用于 GeoTIFF / PNG。
- JPEG 不启用该透明裁剪选项，避免 alpha 丢失后产生黑边。若后续需要 JPEG 精确矩形裁边，应单独走像素级 crop 输出。
- 3D Tiles 已默认把矩形选区转换为 polygon 过滤；矢量下载的矩形选区仍作为 bbox 使用。它们的数据类型天然不同，因此不会强行套用影像的格式/压缩/金字塔选项，只统一任务命名和保存位置这类通用参数。

### 验证

- `npm run build` 通过。
- `cargo check --quiet` 通过。
- `git diff --check` 通过。
- VS Code Problems：无错误。

## 风险与后续

- `start_tile_proxy` 当前没有 stop 命令；只有直连探针失败时才会启动本地端口，影响已降低，但后续仍可补统一代理生命周期管理。
- 如用户仍空白，下一步检查 DevTools Network 中最终失败的原始 Esri URL 或本地代理 URL，用于区分上游代理配置错误、DNS/超时、403 Referer 等问题。
- 输出参数一致性仍可继续深化：普通影像、Wayback 已复用共享输出控件；3D Tiles 和矢量已补齐通用任务参数。后续可继续把任务名称、保存路径、拆分模式再抽成跨页面组件，减少业务页重复代码。
