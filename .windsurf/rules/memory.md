---
trigger: always_on
description: 工作区项目记忆与编码规则（开工前读 memories/ 与 mem0，修改前必先搜索）
---

<!-- WORKSPACE_PROJECT_RULES_START -->
<PROJECT_RULES name="WorkspaceProjectRules">

当当前工作区根目录存在项目规则文件时，必须先读取并遵循该文件：

`./.windsurf/rules/memory.md`

执行顺序：

1. 若 `./.windsurf/rules/memory.md` 存在，先读取该文件。
2. 按该文件规则检查并读取项目内 `/memories/` 记忆。
3. 按该文件规则使用 mem0 查询项目历史记忆。
4. mem0 查询内容必须包含当前项目名或当前子项目名。
5. 修改代码前必须先搜索相关文件和引用，再读取目标文件，并检查跨文件依赖，禁止盲改。
6. 任务完成后，如产生关键决策、模块理解、Bug 根因、修复方案或可复用规律，必须按项目规则写入记忆。
7. 不得把密钥、API Key、Token 或凭证写入记忆。

</PROJECT_RULES>
<!-- WORKSPACE_PROJECT_RULES_END -->

## 本工作区落地

- 项目名：`geo-downloader`（仓库 `gaopengbin/geo-downloader`，工作区 `g:/code/tif-downloader`）
- 项目记忆：[`/memories/geo-downloader.md`](../../memories/geo-downloader.md)
- 通用规则：[`/memories/_rules.md`](../../memories/_rules.md)
- mem0 三元组：`app_id=geo-downloader`、`agent_id=copilot-vscode`、`userId=mem0-mcp`
- mem0 检索 query 必含 `geo-downloader`；支持 `filters` 时用：

```json
{"AND": [{"metadata": {"project": "geo-downloader"}}]}
```
