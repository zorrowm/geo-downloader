# 「默认输出格式」下拉空白 — 根因实证调查（结论：v3.5.2 不复现）

> 调查方式：先实证根因，不凭假设打补丁。最终结论是 v3.5.2 当前源码下该问题**无法复现**，未对生产代码做任何修改。

## 一、问题描述

用户报告：重开程序后，设置页「默认下载参数 → 默认输出格式」下拉框显示**空白**（应显示已保存格式，如 GeoTIFF）。

## 二、最初的（错误）假设

初判为 Radix Select 在 `display:none` 容器中挂载时无法初始化受控 `value` 的显示文本（App.tsx 用 `tab === 'settings' ? 'p-3' : 'hidden'` 切换三个面板，settings 面板默认隐藏挂载）。

据此曾在 `frontend/src/App.tsx` 把 `<SettingsPanel />` 改为 `{tab === 'settings' && <SettingsPanel />}`（按需挂载）。

**此假设后被实证推翻，补丁已回退。**

## 三、实证过程与证据链

### 1. 读真实数据
`C:\Users\<user>\AppData\Local\geo-downloader\settings.json` 中：
```json
"default_format": "geotiff"
```
是**合法值**，不是空串/null。说明不是数据问题；`fromAppSettings` 的 `safeFmt` 兜底（`['geotiff','tiles','mbtiles','gpkg'].includes(fmt) ? fmt : 'geotiff'`）在此用不上，且即便存了空串/非法值也会被纠正为 `geotiff`，下拉数学上不可能空。

### 2. 隔离 repro（用 app 真实依赖版本）
首次 repro 误用 React 18.3.1 / radix-select 2.1.2（与 app 不符），作废。
改用 app 真实版本 **React 19.2 + @radix-ui/react-select 2.2.6** 做 8 个对照用例：

| 用例 | 条件 | trigger 显示 |
|------|------|------|
| t1 | 常驻可见，value 合法 | Beta ✓ |
| t2/t3 | display:none 挂载 → 揭开（含 forceMount） | Beta ✓ |
| t4 | visibility/position 隐藏 → 揭开 | Beta ✓ |
| t5/t6 | display:none，挂载后 a→b | 正确 ✓ |
| t7 | 可见，value undefined→合法，**全程从不打开** | Beta ✓ |
| t8 | **display:none + undefined→合法 + 从不打开** | Beta ✓ |

最严苛的 t8 也正确 → **Radix Select 在各路径下都能显示合法值，`display:none` 不是诱因。**

### 3. 真实前端代码 + 真实数据 + 真实 Tauri
- 起 `npm run dev`（`cargo tauri dev`），vite 在 `http://127.0.0.1:1420`。
- 浏览器打开 1420，用 `page.addInitScript` mock `window.__TAURI_INTERNALS__.invoke`，让 `get_settings` 返回**真实 settings**，跑**真实的 settings-panel.tsx**：

| 场景 | 「默认输出格式」 |
|------|------|
| 切到设置页 | GeoTIFF (.tif) ✓ |
| reload（模拟重开，tab 持久化在设置页） | GeoTIFF (.tif) ✓ |

（vite dev 默认 React StrictMode 双挂载，也正常 → StrictMode 非诱因。）

- 真实 Tauri 原生窗口（`target\debug\geo-downloader.exe`）：用户亲自确认显示 **GeoTIFF，不空**。

### 4. 版本确认
HEAD = `v3.5.2`（最新 release），`safeFmt`（提交 `2d6a755`，React 迁移阶段）已包含其中。

## 四、结论

**v3.5.2 当前源码下「默认输出格式」下拉不会空白，无法复现。** 之前的空白现象很可能来自更早的旧构建（React 迁移前的纯 JS 版本可能存在过类似缺陷，未深究）。

## 五、收尾动作

- `App.tsx` 条件挂载补丁**已回退**为原样 `<SettingsPanel />`（tsc/get_errors 通过，不影响现有功能）。
- 临时调试文件 `target/tmp/radix-repro.html` 已删除。
- 生产代码**净零改动**。

## 六、附：相邻问题确认（清理临时目录前瓦片是否已入缓存 db）

**是。** 下载阶段每张瓦片的 async future 内：网络下载成功且启用缓存时即 `tcache::Store::global().put(...)` 写入缓存 db（`downloader.rs` 约 L375-460）；`cleanup_temp_dir` 仅在全部下载 + 合并/导出完成后才执行，**不会丢数据**。例外：缓存关闭、瓦片 >4MB、空字节、单张 put 失败（计数 + 记日志，但该瓦片仍用于本次导出）。

## 七、方法论沉淀

无法复现类 bug 不要凭假设改代码。实证四步：(1) 读真实落盘数据；(2) 用 app 真实依赖版本（看 package.json，别用记忆里旧版）做隔离 repro；(3) 起真实 dev + 浏览器 mock `__TAURI_INTERNALS__.invoke` 跑真实前端；(4) 让用户在真实原生窗口核验。证伪后回退一切试探性补丁，保持代码整洁。
