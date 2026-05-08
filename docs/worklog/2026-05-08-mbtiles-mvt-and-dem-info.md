# 2026-05-08 MBTiles MVT 输出 / 中文文件名 / 子文件夹 / DEM 信息提示

## 背景
本日 Sunway Loop 串了多个相关问题，集中处理了影像下载链路里的若干小回归与 UX 改进。所有改动均落在 `imagery-page.tsx` + 后端 `commands.rs` / `tile_pack.rs` / `config.rs`。

---

## 0. 注记图层支持：单独导出 + 叠加导出

### 背景
影像图源（天地图卫星 / 矢量 / 地形）以前不带注记。用户要么放弃地名，要么自己在 QGIS 里手贴一层 `cia_w` 注记瓦片。这次把注记作为一等公民塞进下载流程。

### 后端
[`src-tauri/src/config.rs`](../../src-tauri/src/config.rs)：新增三个天地图注记图源
- `tianditu_satellite_label`（cia_w，影像注记）
- `tianditu_vector_label`（cva_w，矢量注记）
- `tianditu_terrain_label`（cta_w，地形注记）

URL 模板沿用现有 `tianditu_*` 同款占位符 + token 注入，最大 zoom 18，attribution 同 © 天地图。

[`src-tauri/src/commands.rs`](../../src-tauri/src/commands.rs)：
- `DownloadRequest` 加 `overlay_sources: Option<Vec<String>>` 字段（`#[serde(default)]`，老前端兼容）
- `execute_imagery_task` 在底图所有瓦片下载完成后插入"叠加合成"流程：
  - 用 `image::imageops::overlay` 把每个 overlay 源对应位置的 PNG 透明合成到底图瓦片之上
  - 直接覆写底图瓦片文件为 PNG（带 alpha）
  - 合成完后 `format_hint` 强制走 `Some("png")`，避免 mbtiles 误标 jpg
- wayback 任务暂不支持 overlay，传 `overlay_sources: None`

### 前端
[`frontend/src/types/api.ts`](../../frontend/src/types/api.ts)：`overlay_sources?: Nullable<string[]>` 写入 `DownloadRequest` TS 类型。

[`frontend/src/features/imagery/imagery-page.tsx`](../../frontend/src/features/imagery/imagery-page.tsx)：
- zod schema 增加 `overlay_sources: z.array(z.string())`，默认 `[]`
- `useWatch` 同步当前选中的 overlay 列表
- 在格式选择区下方新增"叠加注记图层"checkbox 块，列出所有当前 token 可用的注记源（cia_w / cva_w / cta_w），可多选
- 提交时把选中数组直接塞进 `overlay_sources`，与底图 source 一并发送

### 两种使用方式
1. **单独导出注记**：把注记图源（如 `tianditu_satellite_label`）作为主 source 选中，不勾任何叠加 → 输出纯注记 PNG / mbtiles
2. **叠加导出**：选影像底图作为主 source，再勾选注记图源 → 输出"影像+注记"已合成的瓦片

### 验证
- 单独 `cia_w` 下载，输出半透明注记 PNG，可在 QGIS 上面再叠任何底图
- 影像 + cia_w 叠加输出，QGIS / 桌面查看器直接打开就有地名

---

## 1. MVT/PBF 输出 mbtiles 失败：detect_format 不识别 TIFF

### 现象
新加 `tif` 作为内置瓦片格式后，`detect_format` 仅按字节数判断 PNG/JPEG/PBF，把 TIFF 误判为 unknown，导致 mbtiles 写入时类型分支失败。

### 修复
- `src-tauri/src/tile_pack.rs::detect_format` (L178)：新增 4 个 TIFF magic 识别（II*\0、MM\0*、II+\0、MM\0+），返回 `"tif"`。
- `detect_tile_format_with_hint` (L580)：白名单加入 `"tif"|"tiff"`，结合 commands.rs 的 `format_hint`（基于 URL 扩展或叠加合成是 PNG）选出最终格式。
- `commands.rs::execute_imagery_task` (L815, L874)：原始瓦片扩展名映射加 `"tif" => "tif"`，`tile_format` 走 `detect_tile_format_with_hint(&tile_files_clone, format_hint)` → 写入 `mbtiles.metadata.format`。

---

## 2. 天地图卫星 mbtiles 在 QGIS 报"无效图层"

### 现象
用户拖入 `天地图_卫星_z11_xxx.mbtiles`，QGIS 提示"无效图层! 未找到图层数据源"。

### 排查
用 sqlite3 + GDAL Python 直接打开文件：
- 表结构、metadata、169 张 z=11 瓦片完整
- JPEG 头 `FF D8 FF E0 00 10 4A 46`，bytes 没坏
- GDAL 3.9.2 设置 `PROJ_LIB` 后能正常 open，proj_wkt 正确为 EPSG:3857
- 复制为 ASCII 名 `test_satellite_z11.mbtiles` 让用户测试 → **能加载**

### 根因
QGIS / 底层 GDAL 在 Windows 中文路径下打开 SQLite 数据库（mbtiles / gpkg）会失败。GDAL 的 SQLite 驱动走 narrow `fopen`，传 GBK 路径时实际是 UTF-8 字节，SQLite 找不到文件就报"无效图层"。这是 QGIS 已知问题（影响 .mbtiles / .gpkg / .sqlite / .geopackage）。

### 修复（前端）
[imagery-page.tsx#L415-L426](../../frontend/src/features/imagery/imagery-page.tsx)：默认任务名按格式分流。

```ts
const isSqlitePack = values.format === 'mbtiles' || values.format === 'gpkg'
const fallbackName = isSqlitePack
  ? `${values.source}_${levelLabel}`              // ASCII id：tianditu_satellite_z11
  : `${sourceMeta?.name ?? values.source} ${levelLabel}` // 中文人友好名：天地图 卫星 z11
```

- mbtiles / gpkg → 用图源 id（纯 ASCII），避开 QGIS 的中文路径坑
- 其他栅格格式（geotiff/png/jpeg/tiles/pbf）保留中文人类可读名
- 用户手填的 `task_name` 始终透传，不强行改写
- mbtiles 文件内 `metadata.name` 仍写中文（"天地图 卫星"），加载后图层显示名仍是中文

---

## 3. 目录类输出污染父目录

### 现象
用户在 picker 选 `E:\...\zj`，下载完父目录里冒出 `zj_20260508_230431`、`zj_20260508_230553` 等同名兄弟，原 `zj` 目录里反而是空的。

### 根因
[imagery-page.tsx](../../frontend/src/features/imagery/imagery-page.tsx) 的 `appendTimestamp` 在 tiles/pbf 分支直接对路径拼后缀：
```ts
return `${trimmed}_${ts}`     // sibling
```

### 修复
改成在所选目录内部新建带时间戳的子目录，保留原 baseName 便于辨识：
```ts
const baseName = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed
const childName = baseName ? `${baseName}_${ts}` : ts
return `${trimmed}${sep}${childName}`     // child
```

效果：选 `E:\...\zj` → 实际写入 `E:\...\zj\zj_20260508_230553\`。多次下载多个时间戳子文件夹平铺在 `zj` 里，父目录干净。

文件类格式（mbtiles/gpkg/geotiff/png/jpeg）走 `resolveSavePath` 拼接 `<base>.<ext>` 已经在所选目录里面，未改动。

---

## 4. DEM 模式缺少分辨率信息

### 现象
用户问"DEM 是 30M 还是 90M"。原 UI 只显示图源名 "DEM 高程 (Terrarium)"，看不出原始数据精度。

### 修复
[imagery-page.tsx#L77-L106](../../frontend/src/features/imagery/imagery-page.tsx)：新增 `DEM_META` 表 + `metersPerPixelAtEquator` / `formatMeters`，DEM 模式下在图源选择框正下方插入虚线灰色提示卡：

```
原始分辨率：全球约 30 m（高纬度可至 2 m，部分区域 10 m）
覆盖范围：全球，海域不覆盖
编码格式：Terrarium PNG（R/G/B 三通道编码高程，米为单位）
当前级别采样间距：z15 ≈ 5 m/px (赤道)
提示：高 zoom 仅是重采样切片，真实精度受限于原始 DEM 分辨率。
中国大陆范围基本为 30 m。
```

最后一行随 zoom 选择实时变化。AWS Terrain Tiles (Terrarium) 是拼合多源数据集：
- 全球底盘：NASADEM / SRTM ≈ 30 m，中国大陆区域本质就是 30 m
- 高纬度：ArcticDEM / REMA 可达 2 m
- 少数国家：开放 10 m DEM

非 DEM 模式不显示此卡片（`isDemMode && DEM_META[source]` 双条件）。

---

## 5. 待跟进：3D Tiles 下到尾部就不动了（未修，待复现日志）

### 现象
用户截图：642,415 个文件，640,771 成功 + 1,644 失败，进度条满了但任务不退出。

### 初步诊断（基于代码 walkthrough）
- 瓦片下载已全部完成（comp + fail == total）
- 卡的是 `resolve_and_stream` 里的 tileset.json 解析流水线
- 单个 JSON 失败最坏耗时：`reqwest 60s timeout × 6 × MAX_RETRIES 5 + 退避 (500ms + 1s + 2s + 4s + 8s)` ≈ 7 分钟
- 没有 `tokio::time::timeout` 硬切断，没有把 in-flight 解析数暴露给状态行
- 失败 URL 也没落盘，重跑只能从头扫目录树

### 改进方向（待用户确认后实施）
1. 给 `fetch_raw_tileset` 套 `tokio::time::timeout(30s, ...)`，避免 7 分钟黑洞
2. 进度状态行加 "in-flight 解析 N 个 JSON"
3. 失败 URL 落盘 `failed_resolves.txt` / `failed_downloads.txt` 供复跑
4. 长会话末段强制刷新 reqwest client（socket 老化）

需要等用户提供下次复现的日志（`AppData\Roaming\geo-downloader\logs\` 中"解析外部 tileset 失败"行）锁定具体卡死域名。

---

## 验证
- `npm run build`（frontend）通过
- mbtiles 文件本身经 sqlite3 + GDAL 直接确认正确
- 用户口头确认 "纯英文名能加，中文名不能"（QGIS 中文路径 bug）

## 相关 commit / 文件
- `frontend/src/features/imagery/imagery-page.tsx`（主要改动集中处）
- `frontend/src/features/history/history-panel.tsx`
- `frontend/src/features/mvt/mvt-preview.tsx`
- `frontend/src/types/api.ts`
- `src-tauri/src/commands.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/tile_pack.rs`
