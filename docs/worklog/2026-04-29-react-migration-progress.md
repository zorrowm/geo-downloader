# React 迁移工作进度与计划（2026-04-29）

## 总览

`feat/react-migration` 分支记录从旧版 vanilla JS（`static/`）到 React 19 + TypeScript + Vite 8 + Tailwind v4 + shadcn new-york 的完整迁移进度。本文档作为该分支的协作主索引，迁移完成后随分支一并合入 main。

- 当前分支：`feat/react-migration`
- 主分支：`main`（保留旧版可发布状态，不接收迁移过程中的中间提交）
- 合入策略：迁移完全结束、QA 通过后，作为单个 PR 合入 main

## 技术栈

| 维度 | 选择 |
|---|---|
| 框架 | React 19 + TypeScript + Vite 8 |
| 样式 | Tailwind v4 + tw-animate-css |
| 组件库 | shadcn new-york + zinc 基色 |
| 图标 | lucide-react |
| 状态 | Zustand（参数 store / 选区 store / 批量 store …） |
| 数据 | @tanstack/react-query |
| 通知 | sonner |
| 地图 2D | Leaflet 2.x + leaflet-draw |
| 地图 3D | CesiumJS 1.140 |
| Tauri | 2.x（保持与旧前端共用同一 Rust 后端） |

构建命令：

```powershell
cd frontend; npm run build
# dev: cargo tauri dev --config tauri.react.conf.json
```

## 已完成

### 阶段 0：脚手架 + 基础

- React + Vite 项目骨架、Tauri React conf（tauri.react.conf.json）
- 路径别名 `@/`、TS 严格模式
- ThemeProvider（亮 / 暗 + 五色 accent）
- 全局滚动条主题化、`.leaflet-container { isolation: isolate }` 解决 z-index

### 阶段 S1-S3：基础面板

- 骨架切片：错误边界 + 模式 Tab + 关于对话框
- 基础设置面板（settings-panel）
- 图源管理对话框（sources-dialog）
- AppSettings DTO 与 Rust 端对齐

### 阶段 S4：核心业务面板

- S4a 影像下载表单（imagery-page）
- S4b 任务面板（tasks-panel）+ 历史面板（history-panel）
- S4c 地图选区（region-selector / bounds-inputs）+ Shapefile 导入
- 矢量数据下载（vector-panel + vector-page）独立成模式
- 3D Tiles 下载（tiles3d-page）+ Cesium 预览
- Wayback 时间线（wayback-page + wayback-timeline）+ 极速 / 精细模式
- 批量下载对话框（batch-dialog）

### 阶段 S5：信息架构整合

- 把"图源管理"和"关于"从顶栏迁入设置页（"其他"区块）
- 新建 `vector-page` 把矢量从 imagery 中独立
- 三段式布局：左侧栏（download / history / settings）/ 拖拽分割条 / 右侧地图

### 阶段 S6：UX 一致性

- 各模块（imagery / wayback / tiles3d）从手动估算按钮改为自动估算（400ms 防抖）
- 估算结果显示位置紧贴"截止级别"控件（关联性更强）
- WebView2 `confirm()` 非阻塞 → 全部改用 Tauri `ask()`

### 阶段 S7：UI 美化首轮（本日）

- 设计令牌：默认主色从近黑改为现代蓝（`217 91% 55%`），暗色基底带蓝偏（`220 13% 10%`），新增 `--shadow-soft` / `--shadow-pop`
- AppShell 顶栏：渐变图标徽标 + 完整 GeoDownloader 字样、关闭按钮 hover 红、backdrop-blur
- 模式 Tab：胶囊容器 + 内阴影 + 激活态白底主色图标
- 侧栏 Tab：激活态白底 + 主色底线
- Imagery 提交按钮：sticky 全宽 CTA，带 backdrop-blur 顶边
- 新增 `PanelSection` 组件（统一图标 + 标题 + 描述 + body）
- 修复地图状态栏 z-index（z-[400] → z-10），Dialog 蒙层（z-50）可正常覆盖

## 进行中 / 待做

### 阶段 S8：UI 美化继续（优先级高）

- [ ] 把 `PanelSection` 应用到 wayback / tiles3d / vector / settings 各面板
- [ ] 统一 estimate / summary 卡片视觉层级（border + bg-muted/30 + shadow-soft）
- [ ] 表单分组节奏化（gap、Label 字号、Section 间距统一）
- [ ] 历史面板 / 任务面板视觉对齐
- [ ] dark 模式全量回归

### 阶段 S9：功能补齐

- [ ] 可恢复任务（titlebar + 任务面板入口）
- [ ] 批量下载流程在 React 版本对齐（旧版的全部能力）
- [ ] DEM 下载（如有遗漏）
- [ ] 3D Tiles 离线预览本地服务接入
- [ ] 更新检查对话框（update-dialog）走通

### 阶段 S10：QA 与回归

- [ ] 全模式手工回归（imagery / dem / wayback / tiles3d / vector）
- [ ] WebView2 + Win10/11 实机测试
- [ ] 旧前端（`static/`）作为 fallback 保留至验收通过
- [ ] `tauri.conf.json` 切换默认指向 React 构建产物
- [ ] 文档（README / promotion）截图与说明更新

### 阶段 S11：合入主分支

- [ ] 删除 `static/` 旧前端（或保留 `legacy/static`）
- [ ] 删除 `tauri.react.conf.json`，把配置合并进 `tauri.conf.json`
- [ ] 单 PR 合入 main，附完整 changelog

## 关键约束 / 踩坑记录

- **WebView2 `window.confirm()` 非阻塞**：必须用 `await window.__TAURI__.dialog.ask()`，否则代码继续执行，导致下载先于用户确认
- **Tauri `convertFileSrc` 编码 Windows 路径**：会把 `\` 编码为 `%5C`，破坏相对 URL 解析；3D Tiles 必须走本地 HTTP 服务（`serve_local_tiles`）
- **Leaflet z-index 200-800**：必须给 `.leaflet-container` 加 `isolation: isolate`，否则 Dialog 蒙层被盖
- **地图浮层 z-index**：保持 ≤ z-10，避免越过 shadcn Dialog 的 z-50
- **`multi_replace_string_in_file` 同形跨文件替换风险**：替换后必须 `cargo check` / `get_errors`，不能只看工具的"successful"
- **TIFF LZW 编码**：`weezl::Encoder::with_tiff_size_switch`（不是 `new`），否则 libtiff 解码失败
- **BigTIFF inline 存储**：≤ 8 字节的 tag 必须 inline，不能写外部 offset，否则 GDAL/QGIS 读不开

## 文件结构

```
frontend/src/
├── App.tsx                       # 主入口、模式 / Tab 路由
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx         # 顶栏（drag region + 模式 Tab + 窗口控制）
│   │   └── panel-section.tsx     # 通用面板分组容器（NEW）
│   ├── theme/                    # ThemeProvider + ThemeSwitcher
│   └── ui/                       # shadcn 组件（new-york）
├── features/
│   ├── about/                    # 关于对话框（迁入设置页）
│   ├── batch/                    # 批量下载
│   ├── history/                  # 历史
│   ├── imagery/                  # 影像 + DEM 下载
│   ├── map/                      # Leaflet + Cesium canvas
│   ├── promo/                    # 推广（Star / Sponsor / Community）
│   ├── region/                   # 选区器、坐标输入
│   ├── settings/                 # 设置页（含图源管理 / 关于入口）
│   ├── sources/                  # 图源管理对话框
│   ├── tasks/                    # 任务面板
│   ├── tiles3d/                  # 3D Tiles
│   ├── update/                   # 更新检查
│   ├── vector/                   # 矢量下载
│   └── wayback/                  # Wayback 时间线
├── store/                        # Zustand stores
├── lib/                          # 工具（cesium-loader 等）
└── index.css                     # 设计令牌 + 全局样式
```

## 协作约定

- 不使用 emoji（lucide / SVG / 文字符号代替）
- `git push` 仅在用户明确"推送"时执行
- 重要进展同步更新本文档（追加 / 勾选 todo）
- 多文件批量改动后必须 `npm run build` 验证
