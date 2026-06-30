# 2026-06-30 多边形/圆形裁剪导出"外接矩形 + 黑边"修复

## 现象

群友（geod）反馈：天地图历史影像，选区为圆形或不规则多边形时，下载下来的是**外接矩形**，多边形外是**黑边**，且**黑边里仍有真实影像数据**。附测试 shapefile（一个圆 + 一个多边形）。版本表：v3.2.2 及以下能精确下载（但只能合并要素、不能拆分），v3.3.0 起到 v3.6.2 均不能精确裁剪（v3.4.0~v3.4.4 另有"导入贴图失败"bug 掩盖）。

## 根因

流式导出器在裁剪时**只清除 alpha 通道**，先把整张外接矩形的 RGB 全部画上，再把多边形外像素的 alpha 设为 0 → 环外每个像素是 `(真实RGB, alpha=0)`。忽略/拍平 alpha 的软件就显示出完整外接矩形，且"黑边里有数据"。

- `streaming_tiff.rs::merge_and_export_streaming`（RGB GeoTIFF）
- `streaming_raster.rs::merge_and_export_streaming_png`（PNG）

DEM 路径（`merge_and_export_dem_streaming`）本就正确：构造 inside 掩码、环外清零为 NoData。内存版 `merger::mask_image_by_polygons`（v3.2.2 及以下走的路径）也正确：`dst_raw` 初始全零，仅环内拷贝 RGB → 环外 `(0,0,0,0)`。

## 调查方法（实证，非猜测）

1. `git diff v3.3.0..v3.4.5 -- streaming_tiff.rs` 证明裁剪几何代码逐字节未变（只 `PathBuf→TileSource` + 追加 DEM）→ 排除"某版本改坏几何"。
2. 读 v3.2.2 / v3.3.0 的 `commands.rs` 导出分发：
   - v3.2.2：`use_streaming = is_geotiff && count>5000 && !(crop && polygon)` → 裁剪**禁用流式**，走内存版硬裁剪（正确）。
   - v3.3.0：`use_streaming = is_geotiff || is_png` → 裁剪改道流式软裁剪（只清 alpha）→ 引入问题。
3. 逐行对比两个 masker 对环外像素的处理：内存版清 RGB，流式版只清 alpha。
4. 写 RED 测试取证：环外像素读到 `[50,100,150,0]` 而非 `[0,0,0,0]`。
5. 用反馈附带的真实 shapefile 几何（圆 92 顶点 / 多边形 7 顶点，均 WGS84）端到端验证。两个 `.prj` 都是 GCS_WGS_1984，排除坐标系干扰。

## 修复

两条流式路径环外像素改为整像素清零（RGB + alpha），与内存版 / DEM 版一致。对尊重 alpha 的软件渲染结果不变。

## 验证

- `cargo test --lib`：66 项通过，含 4 条新增裁剪回归测试（合成 + 真实圆 + 真实多边形）。
- 前端 `tsc -b && vite build` 通过。

## 关联

- 拆分（split）模式本就把每个要素的 polygon 分别送入同一 masker，修复后每个要素各自精确裁剪。
- 发版 v3.6.3。
