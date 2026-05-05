# KML / KMZ 边界导入支持（Issue #16 / #17 / #18 / #19）

## 背景
用户反馈希望支持导入 KML 边界文件。原本区域选择只支持 GeoJSON 与 Shapefile。

## 决策：客户端解析
原 issue 描述提到由 Rust 后端使用 `kml` crate 解析。最终采用**前端 JavaScript 直接解析**的方案，理由：
- 现有 Shapefile 路径就是前端 `shpjs` 客户端解析（无后端命令），保持一致
- 客户端解析无需新增 Tauri 命令、无需序列化跨进程，链路最短
- 浏览器内置 `DOMParser` + 成熟的 `@tmcw/togeojson` 足以覆盖常见 KML
- KMZ 仅是 zip 容器，`jszip` 已是 `shpjs` 间接依赖，再显式声明很轻量

## 改动清单
- 新增 deps：`@tmcw/togeojson@^7`、`jszip@^3`
- 新增 `frontend/src/lib/geo-import.ts`
  - 导出 `parseRegionFile(file)`：统一处理 `.geojson` / `.json` / `.zip` / `.shp` / `.kml` / `.kmz`
  - 导出 `REGION_FILE_ACCEPT_ATTR` 常量供 `<input accept>` 使用
  - 导出 `UnsupportedRegionFileError` 自定义错误类型
  - KMZ 取 `doc.kml` 优先，否则取首个 `.kml`
- `frontend/src/features/region/region-selector.tsx`：替换原内联解析为 `parseRegionFile`，input accept 与按钮 title 同步更新
- `frontend/src/features/vector/vector-panel.tsx`：同上
- `README.md` 区域选择章节追加 KML / KMZ
- `site/index.html` 区域选择文案追加 KML / KMZ

## 已知限制
- 仅提取 Polygon / MultiPolygon / 内嵌于 MultiGeometry / Folder 的多边形，不支持 LineString / Point 作为下载区域
- 不解析 KML 的样式 / 时间戳等元数据
- KMZ 中如包含多个 `.kml`，仅读取第一个

## 验证
- `npm run build` 通过
- 现有 Shapefile / GeoJSON 路径不受影响（同一入口）
