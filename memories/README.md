# Memories — 项目记忆目录

本目录承载 **GeoDownloader (geo-downloader)** 项目的核心层记忆。会话开工前必读，沉淀完任务后追加。

## 目录约定

| 文件 | 用途 | 维护原则 |
|---|---|---|
| [`_rules.md`](./_rules.md) | 通用记忆规则（双层模型 + 双写协议 + mem0 写入规范） | 跨项目一致，谨慎修改 |
| [`geo-downloader.md`](./geo-downloader.md) | 本项目核心层：构建命令 / 红线 / 高频踩坑 / 待办索引 | ≤ 200 行；超量迁 mem0 |

## 与 `.github/copilot-instructions.md` 的关系

`.github/copilot-instructions.md` 的 `## 记忆双写` 节是 Sunway Loop 扩展自动维护的极简摘要；本目录是它指向的完整实现，规则更详尽（含 `userId`、`metadata.project`、`category` 取值等）。两者**互补不冲突**。

## 开工前必做（每次新会话）

1. 读 [`geo-downloader.md`](./geo-downloader.md) 获取项目高频上下文
2. 调 mem0 `search_memories`，query 含 `geo-downloader`，必带 `filters.project=geo-downloader`
3. 必要时回查 [`../docs/worklog/`](../docs/worklog/) 对应日期的工作记录

## 触发写入的时机

完任务 / 探模块 / 修 bug / 悟规律 / 犯错后，按 `_rules.md` 的双写协议判定：

- **高频**（每次新会话都得知道）→ 双写：核心层追加摘要 + mem0 写完整背景
- **按需**（特定场景才用）→ 只写 mem0
