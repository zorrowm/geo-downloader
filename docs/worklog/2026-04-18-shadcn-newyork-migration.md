# shadcn new-york 迁移工作记录（2026-04-18）

## 总览

将 tif-downloader 前端逐步迁移到 shadcn new-york 风格主题系统，按 A→G 七批推进。本日完成 A、B 两批的全部细化和地图模块的初步清理。

## 已完成

### 批 A：基础环境

- 配置 shadcn MCP 服务（`.vscode/mcp.json`，cwd 指向 `frontend/`）
- 安装 `tw-animate-css`，`@import "tw-animate-css"` 加入 `frontend/src/index.css`
- 加 `@custom-variant dark (&:where(.dark, .dark *));`，使 Tailwind v4 走 class 暗色策略
- 字体：`@fontsource-variable/geist` + `geist-mono`

### 批 B：主题系统 + 视觉细化

- ThemeProvider：`<html class="light|dark" data-accent="zinc|blue|green|violet|orange">`，持久化 key `gd:theme-mode`、`gd:theme-accent`
- ThemeSwitcher 拆为 2 按钮：Sun/Moon click-toggle + Palette dropdown(5 色)
- `DropdownMenuContent` 改 `z-[9999]`，去掉 `animate-in/zoom` 类
- 8 个 ui 组件阴影统一降为 new-york 风格：card/input/button/select/dialog/sonner/switch/dropdown
- 字号回退 Tailwind 默认（不再覆盖 `--text-*`）
- 全局滚动条：10px 宽，6px thumb，theme-aware（用 `--border` / `--muted-foreground`）
- `.leaflet-container { isolation: isolate }` 隔离地图层级，使 dialog z-50 可正常覆盖

### 字号 cascade 重大根因（已记入 user memory）

- `button, input, select, textarea { font: inherit }` 顶层 CSS 规则会覆盖 `text-xs/sm` 工具类
- 根因：Tailwind v4 中，无 `@layer` 的顶层规则优先级高于 utilities layer
- 修复：改成 `font-family: inherit`，并整体包入 `@layer base`

### 地图清理

- `frontend/src/features/map/map-canvas.tsx`：
  - 移除 Shapefile 上传 input + 按钮
  - 移除"清除"按钮（用户确认）
  - 删除 `Eraser` / `Button` / `shp` / `geojson` 类型导入
  - 删除 `handleImport`、`handleClear`、`ringsFromGeoJSON` 函数
  - 删除 `[importing, setImporting]` state，仅保留 `error` 用于未来错误气泡
  - 浮动工具条整段移除，右上角现在只有 error 提示

## 待做（按顺序继续）

| 批 | 内容 | 备注 |
|---|---|---|
| C | 矢量数据 | OSM 下载、下载边界、加载本地、清除图层；清除入口需要从地图迁移到侧栏或 region-selector |
| D | 3D Tiles | |
| E | DEM | |
| F | Wayback | |
| G | 标题栏 | Star 链接 + 赞助 + 可恢复任务 |

## 关键文件

- `frontend/src/index.css`：design tokens、滚动条、leaflet isolation
- `frontend/src/components/theme/theme-switcher.tsx`
- `frontend/src/components/ui/dropdown-menu.tsx`：`z-[9999]`
- `frontend/src/components/layout/app-shell.tsx`：titlebar
- `frontend/src/features/map/map-canvas.tsx`：浮动工具条已清空
