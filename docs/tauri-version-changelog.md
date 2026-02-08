# Tauri 版本更新日志

## 概述

本分支 (`tauri-version`) 将原有的 Python/FastAPI + PyWebView 桌面应用完全重构为 Tauri + Rust 实现，带来显著的性能提升和更小的安装包体积。

## 技术栈变更

| 组件 | 旧版本 | 新版本 |
|------|--------|--------|
| 后端 | Python 3.10 + FastAPI | Rust + Tauri 2.0 |
| 前端 | HTML/CSS/JS + Leaflet | 同上 (保持不变) |
| 桌面封装 | PyWebView + PyInstaller | Tauri (原生 WebView) |
| 图像处理 | PIL/Pillow + Rasterio | image + tiff-encoder |
| HTTP 客户端 | aiohttp | reqwest (异步) |

## 新增功能

### 1. 多图源与自定义图源
- 内置 10+ 图源：OSM、ArcGIS 卫星/地形/街道、天地图矢量/卫星/地形、Carto、Google Maps、高德地图/卫星、OpenTopoMap
- 支持用户自定义图源（`{z}/{x}/{y}` 格式），可添加/编辑/删除
- 图源按名称首字母排序

### 2. 多任务并行下载
- 支持同时创建多个下载任务（影像 + OSM 矢量）
- 每个任务独立进度显示，支持取消
- **支持暂停/继续下载**（任务卡片“暂停”按钮，暂停后停止拉取新瓦片，已在飞行中的自然完成）
- 完成的任务 2 秒后自动移除
- 后端使用 tokio 异步任务 + CancellationToken + PauseControl

### 3. 下载历史记录
- 自动记录每次下载（图源、缩放、瓦片数、文件大小）
- 支持快速打开文件所在文件夹
- 支持单条删除和一键清空

### 4. 设置持久化
- 天地图 Token、代理、并发数、缩放级别、自定义图源等设置自动保存至 `settings.json`

### 5. GCJ-02 坐标处理
- 自动检测高德/Google 等 GCJ-02 图源并显示偏移警告
- 行政边界坐标自动转换为 WGS-84

### 6. 任务日志系统
- 每个任务独立日志，实时记录下载/重试/拼接/导出全流程
- 任务卡片“日志”按钮展开终端风格日志面板（深色背景、等宽字体、颜色分级）
- 日志同步持久化到文件 (`{AppData}/tif-downloader/logs/task_*.log`)
- 内存中最多保留 500 条，自动滚动到底部

### 7. 断点续传
- 任务开始前持久化任务参数到 `{AppData}/tif-downloader/tasks/`
- 崩溃/异常退出后重启可看到“中断的任务”，支持“继续下载”或“丢弃”
- 下载时自动跳过已存在的瓦片文件（按文件名 + 非空检查）
- 活动任务自动排除在可恢复列表之外

### 8. GeoTIFF 优化
- 导出带完整 GeoTIFF 投影标签 (EPSG:3857 Web Mercator)
- 支持 LZW 无损压缩
- 大图像自动使用 BigTIFF 格式
- 流式写入器支持超大范围导出（内存仅需一行瓦片宽度）

### 9. 界面全面优化
- Tab 导航：下载配置 / 下载中心 / 设置
- 自定义标题栏（最小化/最大化/关闭）
- 缩放级别直观描述（z15 · 街道级）
- Leaflet 本地化部署，无 CDN 依赖

## 性能优化

### 1. 瓦片拼接优化
- 使用 `image::imageops::replace` 替代逐像素操作
- 内存预分配，减少重新分配开销

### 2. 多边形裁剪优化
- 实现扫描线算法替代逐点检测
- 直接操作字节数组，性能提升 10x+

### 3. TIFF 导出优化
- 使用 `TiffEncoder` 直接编码
- 预分配缓冲区，避免多次内存分配

### 4. 下载稳定性
- 每个请求独立 8 秒超时，单瓦片最多重试 2 次
- 打乱瓦片顺序避免限速时失败集中在同一列
- 失败瓦片进入重试队列（最多 3 轮，递减并发 + 递增等待）
- `tokio::select!` + 独立 3 秒定时器，即使所有瓦片卡在重试也能报告进度
- 实时显示“N 个瓦片正在重试”状态

## 代码结构

```
src-tauri/src/
├── lib.rs          # 应用入口，插件注册
├── commands.rs     # Tauri 命令 (供前端调用)
├── config.rs       # 配置常量，内置图源定义
├── tile.rs         # 瓦片坐标计算
├── downloader.rs   # 异步并发下载器
├── merger.rs       # 瓦片拼接，多边形裁剪
├── exporter.rs     # 图像导出 (GeoTIFF/PNG/JPEG)
├── admin.rs        # 行政区划数据
├── streaming_tiff.rs # 流式 BigTIFF 写入器
├── task.rs         # 多任务管理、暂停控制、日志、断点续传
├── history.rs      # 下载历史记录
└── settings.rs     # 用户设置持久化
```

## 前端变更

### index.html
- Tab 导航布局：下载配置 / 下载中心 / 设置
- 自定义标题栏控件
- 动态图源下拉框（从后端 API 加载）
- 自定义图源管理 UI
- 任务卡片和下载历史列表

### style.css
- 现代设计风格，变量化主题
- 任务卡片样式（下载中/完成/失败状态）
- Tab 导航样式
- Leaflet 控件主题适配

### app.js
- 动态图源加载与排序 (`loadMapSources`)
- 自定义图源 CRUD (`addOrUpdateCustomSource`, `editCustomSource`, `removeCustomSource`)
- 多任务管理 (`addTaskCardToUI`, `startTaskListener`, `updateTaskCard`)
- 下载历史 (`loadDownloadHistory`, `renderHistoryCard`)
- 设置持久化 (`saveAllSettings`, `applySettings`)
- GCJ-02 偏移警告

### api.js
- Tauri IPC 适配层，封装所有后端命令

## 已删除的旧代码

- `app/` - Python FastAPI 后端
- `desktop.py` - PyWebView 入口
- `requirements.txt` - Python 依赖
- `*.bat` - 旧的批处理脚本
- `*.spec` - PyInstaller 配置

### 全国行政区划
- 省份下拉顶部新增“全国”选项 (adcode 100000)

### 10. 多边形裁剪 Mercator 投影修正
- 多边形裁剪坐标参考从用户选区改为瓦片网格边界，修复裁剪边界整体偏移
- 纬度→像素映射从线性插值改为 Mercator 投影 (`ln(tan(π/4 + lat/2))`)，修复行政边界与实际影像的偏移
- 同步修复 `crop_to_bounds` 的同类问题

## 后续计划

- [x] 支持断点续传
- [x] 任务暂停/继续
- [x] GeoTIFF 地理参考与多边形裁剪偏移修复
- [ ] 国际化支持
