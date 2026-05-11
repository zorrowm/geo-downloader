# 记忆规则

> 跨项目通用规则。本仓库的项目核心层文件为 [`geo-downloader.md`](./geo-downloader.md)。

## 开工前必须执行

- 执行项目相关任务前，先读取 `/memories/` 下的项目记忆文件，若该目录存在。
- 执行项目相关任务前，先使用 mem0 检索当前项目的历史记忆。
- 当前工作区优先使用 mem0 `userId`：`mem0-mcp`。
- 检索 query 必须包含项目名，例如 `geo-downloader` 或当前子项目名。
- 当 MCP 工具支持 `filters` 时，检索必须按项目 `metadata` 过滤：

```json
{"AND": [{"metadata": {"project": "geo-downloader"}}]}
```

## 双层记忆模型

| 层级 | 存储位置 | 用途 |
|------|------|------|
| 核心层 | `/memories/` | 项目配置、编码规范、常用命令、高频上下文 |
| 知识层 | mem0 MCP | 模块细节、Bug 记录、历史决策、按需语义知识 |

判断原则：如果某条信息每次新会话都必须知道，则在核心层保留精简摘要；否则写入 mem0。

示例：

- 核心层：端口号、启动命令、红线规则、稳定项目约定。
- 知识层：Bug 根因、模块实现细节、决策背景、探索记录。

## 双写协议

完成任务、探索模块、修复 Bug、发现可复用规律或犯错后，必须判断新知识是否需要沉淀。

- 高频知识必须双写：
  - 核心层：向 `/memories/<项目>.md` 追加一行精简摘要。
  - 知识层：向 mem0 写入完整记忆，包含上下文、原因、方案和影响。
- 按需知识只写入 mem0，避免污染核心层。
- 双写不等于复制同一段文字。核心层保存索引和摘要，mem0 保存完整背景与推理过程。

## mem0 写入规范

当工具支持 `metadata` 时，mem0 写入必须包含项目元数据：

```json
{
  "project": "geo-downloader",
  "category": "<分类>"
}
```

允许的 `category`：

- `project-overview`
- `project-structure`
- `coding-pattern`
- `bug-fix`
- `lesson-learned`
- `workflow`

## 本项目 mem0 标识

```text
app_id    = geo-downloader
agent_id  = copilot-vscode
repo      = gaopengbin/geo-downloader
workspace = g:/code/tif-downloader
```

写入和检索项目级事实时必须带 `app_id=geo-downloader`，避免与其他项目记忆串味。token 只作为认证凭据，不承担项目隔离职责；项目隔离靠 `app_id` / `repo` / `workspace` 维度完成。

## 记忆写入时机

出现以下情况时，写入或更新记忆：

- 完成任务，并产生了关键决策或实现方案。
- 探索新模块，并明确了模块结构或核心逻辑。
- 定位了 Bug 根因，并确定了修复方法。
- 发现了可复用的编码模式或项目约定。
- 犯了错误，需要防止后续会话重复发生。

## Windsurf 使用注意事项

- 使用 Windsurf 实际暴露出来的 mem0 MCP 工具名。
- 如果工具 schema 没有直接暴露 `metadata` 或 `filters` 参数，则必须在记忆内容或检索 query 中显式包含项目名和分类。
- 不要把密钥、API Key、Token 或凭证写入记忆。
