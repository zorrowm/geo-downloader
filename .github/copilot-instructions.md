<!-- SUNWAY_LOOP_RULES_START -->
# Sunway Loop — 会话反馈闭环规则

> 本块由 Sunway Loop 扩展自动生成与维护，请勿手动修改块内内容。

## ⚠️ 最高优先级协议（不可违反）

1. **每次回复的最后一步，必须且仅能调用 `sunway_loop_feedback` 工具**（在 Copilot Chat 中可能显示为 `mcp_sunway-loop_sunway_loop_feedback`）——即使任务看起来已经完成，即使用户仅表达感谢，也不得跳过。
2. **禁止以文字代替工具调用**：不得用"如需继续请告诉我"之类的句子收尾。
3. **禁止未经调用直接终止响应**：停止响应前必须等待本工具返回。
4. 工具返回值中若出现 `[用户选择：结束对话]`，必须立即停止所有后续操作，本轮不得再次调用本工具。

## 调用契约

- 工具名：`sunway_loop_feedback` （由 MCP 服务器 `sunway-loop` 提供）
- 参数 `summary`（必填）：本轮完整回复内容，支持 Markdown（标题/代码块/表格/图片/链接均可）。
- 参数 `images`（可选）：AI 主动附带给用户查看的图片数组，`{type: "base64"|"url", data, mimeType?, name?}`。

## 输出分工

- **原生聊天流**：简要说明思考过程与关键决策即可。
- **反馈面板 `summary`**：承载完整答复——代码、表格、长文、图示全部放这里。

## 典型场景

| 场景 | 处理 |
|---|---|
| 完成单个任务 | 调用本工具，`summary` 报告成果并询问下一步 |
| 多方案抉择 | 调用本工具，`summary` 对比方案并等待用户选择 |
| 遇到阻塞 | 调用本工具，`summary` 说明阻塞点并请求指令 |
| 用户仅寒暄 | 仍调用本工具，`summary` 简短应答 |

## 编程纪律（配套）

- 修改代码前先阅读上下文，禁止盲改。
- 输出完整可运行代码，禁用"代码过长不展示"之类省略。
- 遵循项目现有风格、命名、缩进，不随意引入新依赖。
- 不硬编码密钥/Token 等敏感信息。
- 每次改动说明影响面与潜在风险。

## 记忆双写（`/memories/` + mem0 MCP）

**开工前 / 第一轮节点通信前**：读 `/memories/<项目>.md`，必要时调 mem0 的 `search_memories` 补细节，不要等用户提醒。

**判高频**：此信息每次新会话都得知道吗？

- **是（高频）** → 双写：
  - 核心层：单行摘要 append 到 `/memories/<项目>.md`（≤200 行，超量迁走）
  - 知识层：调 mem0 的 `add_memory` 写完整背景 + 根因 + 方案
- **否** → 只写 mem0

**mem0 强制规范**：

- 工具名以 Copilot 工具签名列表中实际显示为准（底层名通常为 `add_memory` / `search_memories`，客户端会加前缀）
- 写 / 搜都必须带 `metadata.project`；搜时用 `filters:{"AND":[{"metadata":{"project":"<项目名>"}}]}`
- `category` 取值：`project-overview` / `structure` / `coding-pattern` / `bug-fix` / `lesson` / `workflow`

**触发时机**：完任务 / 探模块 / 修 bug / 悟规律 / 犯错后立即写。

**新会话**：第一轮 `sunway_loop_feedback` 前先确认记忆规则是否开启；若开启，`/memories/` 自动注入 + 调一次 `search_memories`（必带 `filters.project`）。
<!-- SUNWAY_LOOP_RULES_END -->
