# 全盘 Bug 扫描报告（v3.5.2 后）

> 只读扫描，未修改任何代码。覆盖 `src-tauri/src/` 全部 Rust 模块 + `frontend/src/` React 前端。
> 严重度：高 = 会崩溃/数据损坏/数据丢失；中 = 错误结果/资源泄漏/可靠性缺陷；低 = 边界/精度/可观测性瑕疵。

## 一、严重度汇总

| 严重度 | 数量 | 说明 |
|---|---|---|
| 高 | 12 | 必须修复，涉及 panic、文件损坏、死锁、数据竞争、路径穿越 |
| 中 | 30+ | 错误结果、资源泄漏、可靠性缺陷 |
| 低 | 20+ | 精度、边界、可观测性、性能 |

整体健康度：**B / 中等偏上**。核心算法（坐标转换、预算估算、递归去重、整数饱和）基本扎实，主要风险集中在「持久化层鲁棒性」「并发状态机」「TIFF 字节级编码」「字节切片 panic」四类。

---

## 二、高优先级（必修）

### 导出/编码（数据损坏，最高优先）

- **streaming_tiff.rs:350/353** | 高 | BigTIFF "≤8 字节必须内联" 规则被违反：单行瓦片导出（num_strips==1）时 StripOffsets/StripByteCounts 错误写成外部偏移 → **生成损坏的 TIFF 文件**。`pyramid.rs:464` 处理正确，可对照修复。
- **streaming_tiff.rs:730/733** | 高 | DEM 导出路径同样的 BigTIFF 内联缺陷。
- **fetcher.rs:92 / fetcher.rs:182** | 高 | 3DTiles 错误/响应预览用 `&text[..len.min(N)]` 按**字节**切 String，非 ASCII（中文/UTF-8）body 在边界处 **panic 崩溃**。

### 并发/状态机

- **task.rs:87** | 高 | `PauseControl::wait_if_paused` 存在 tokio `Notify` 丢失唤醒竞态 → 暂停后**永久卡死无法恢复**。修复：先创建 `Notified` future 再检查 flag。
- **task.rs:16-29/240** | 高 | 无独立 `PendingDecision` 变体，复用 `TaskStatus::Paused`；`toggle_pause` 会把待决策任务翻成假 `Downloading` → 永久卡死。
- **commands.rs:1833** | 高 | `resume_task` 缺「任务已活动」守卫（不像 `export_partial_task:2098`）→ 同一 task_id 双 `execute_download_task` 循环写同一 temp_dir/save_path → **数据竞争/文件损坏**，旧循环无法被取消。

### 缓存/安全

- **tile_cache/pool.rs:92-99** | 高 | `close()` 在持有全局 `inner` 锁时执行 SQLite checkpoint/close（IO）→ **死锁/阻塞**。`handle()`/`shutdown()` 正确先释放锁。
- **tile_cache/mod.rs:19-21+99-117** | 高 | `SourceKey(pub String)` 公开字段绕过 slugify；`parse_gdcache_uri` 返回未净化 source → **路径穿越**（`../../x.mbtiles`）。

### 内存/溢出 panic

- **merger.rs:168** | 高 | `cols = x_max - x_min + 1` 裸 u32 减法（x_max<x_min 时 panic）。
- **merger.rs:171** | 高 | `width = cols * TILE_SIZE` u32 乘法溢出 + 无上限 RgbImage → OOM。
- **history.rs:124** | 高 | `add` 是 read-modify-write 且无锁 → 并发完成时**丢历史记录**（TOCTOU lost-update）；`update`/`delete` 同样受影响。

### 空间过滤

- **filter.rs:205-280** | 高 | `box_to_rect`/`sphere_to_rect` 完全忽略 `tile.transform` 矩阵，把局部坐标当 ECEF → 经纬度全错 → box/sphere 类型 tileset **空间过滤结果系统性错误**（误删/误留）。

---

## 三、中优先级（建议修复）

### TIFF / 栅格编码

- streaming_tiff.rs:740 | GDAL_NODATA(42113) 6 字节 ASCII 错误外置 → NoData 失效，-9999 被当真实高程。
- streaming_tiff.rs:237 / streaming_raster.rs:139 / streaming_tiff.rs:623 | 扫描线 `(xj-xi)*(global_y-yi)` i32 溢出（应 i64）。
- streaming_tiff.rs:94 / streaming_raster.rs:29 / streaming_tiff.rs:488 | `width = cols*TILE_SIZE` u32 溢出。
- merger.rs:347 | `get_pixel(left+x, top+y)` 裁剪范围超源时越界。
- merger.rs:282 | 扫描线 `(xj-xi)*(yi-yyi)` i32 乘法溢出。

### 任务/命令编排

- task.rs:191/200/218 | complete/fail 缺终态保护，Cancelled 可被覆写成 Completed。
- task.rs:166-180 | `update_progress` 终态保护未覆盖 Paused，暂停状态会被回调闪回 Downloading。
- commands.rs:770 | `failed_count = actual_count - tile_files.len()` 裸减法。
- commands.rs:1604-1635 | CompletedWithGaps + export_partial + resume 链路重复写历史。
- commands.rs:1117-1175 | 流式导出阶段无取消检查，取消时残留半成品目标文件。
- commands.rs:735-751 | `completed > total` 进度可能 >100%；末尾 total 口径跳变。

### 缓存

- tile_cache/pool.rs:29-46 | LRU 可淘汰在用连接，遗留孤儿 -wal/-shm。
- tile_cache/mod.rs:209-213 | `set_root_dir` 非原子（先 shutdown 再改配置）。
- tile_cache/store.rs:24-40 | 未设置 `busy_timeout` PRAGMA。
- tile_cache/active_downloads.rs:14 | `BROWSE_FILLED` 全局计数器被并发任务共享。
- tile_cache/active_downloads.rs:32-36 | `DownloadGuard` 按 source 字符串注销，会清掉其他并发 guard 的坐标。
- tile_cache/pool.rs:207-244 | `stats()` size_bytes 不含 -wal → prune 可能不触发。

### 持久化鲁棒性（共性）

- settings.rs:174 / history.rs:175 / wayback.rs:83-91 / wayback_metadata.rs:464 | `fs::write` 非原子，崩溃/断电截断 JSON。应写临时文件再 rename。
- settings.rs:163 / history.rs:120 / wayback.rs:95 | 部分损坏 JSON 直接 Err 无回退/备份 → 功能 brick。
- settings.rs:151 / history.rs | 无并发锁，多 command 并发写交错损坏。
- history.rs | 历史无容量上限，O(n) 全文件重写。

### 预算/估算

- budget.rs:191 | `pixel_bytes` u64 乘法可能溢出 → 估算变小 → 预算检查误放行 → OOM。应 checked/saturating_mul。

### Wayback

- wayback.rs:300-302 | `lat_lng_to_tile` 无边界裁剪，越界坐标静默钳到 0 → 探测错误瓦片。
- wayback.rs:290 | `probe_max_zoom` 用 HEAD + is_success（Esri 可能不支持 HEAD）。
- wayback_metadata.rs:651-652 | `from_timestamp(..).unwrap_or_else(Utc::now)` 伪造日期 → 污染去重键。
- wayback_metadata.rs:298 | `prune_cache_lru` 用 mtime 而非真 LRU。

### 3DTiles

- filter.rs:230 | ECEF→经纬度跨 180° 经线取 min/max 形成假全球包围盒 → 海量误下载。
- filter.rs:45 | region 跨反经线（west>east）相交判定失效。
- fetcher.rs:742 | `with_extension("tmp")` 临时名碰撞（a.glb/a.b3dm → a.tmp）→ 并发写串台。
- fetcher.rs download/resolve_failures | 部分失败仍返回 Ok，整棵子树丢失被静默吞掉。
- tileset.rs geometric_error | 无 `#[serde(default)]`，省略字段导致整份解析失败。

### 行政区划

- admin.rs:~470 | `osm_to_geojson` 节点缺失时仍标 Polygon → 非闭合非法 ring。
- admin.rs:~640 | `tianditu_query` 手拼 JSON 只转义双引号，不转义反斜杠/控制字符。

### 前端

- wayback-page.tsx:148 | `scanAbortRef` 从未被设为 true（死代码）+ 扫描轮询无卸载清理 → 切换 mode 后悬挂轮询 + 卸载后 setState。
- update-dialog.tsx:84 | 下载成功路径不复位 `downloading` → 对话框可能卡死无法关闭。

---

## 四、低优先级（择机优化）

- downloader.rs:653/659 | `failed -= 1` 裸减法。
- downloader.rs cancel 路径 | temp_dir 瓦片未清理，断点续传误判。
- downloader.rs:280-360 | 全缓存命中区域 Bytes 留内存 HashMap → 大区域 OOM 风险。
- tile_pack.rs ~470 | 瓦片读取失败静默 continue（数据丢失仍返回成功）。
- tile_cache/mod.rs:137-167 | 纯非 ASCII source 名 slugify 成 "source" → 缓存键碰撞。
- task.rs:159 | `&id[..8]` 无长度守卫（当前 UUID 安全）。
- wayback_metadata.rs:383/390 | release_id 字符串排序 + `parse().unwrap_or(0)` 塌缩。
- config.rs:18 | `ALLOW_INVALID_CERTS` 用 Relaxed 内存序。
- admin.rs | 经纬度无范围校验、bbox 未做 GCJ→WGS 转换、每次新建 reqwest::Client 不走全局 TLS 开关。
- 前端 mvt-preview.tsx:333 stale closure；tasks/history-panel 日志用数组下标作 key；App.tsx setTimeout 未清理；cesium-canvas 不 destroy。

---

## 五、建议修复顺序

1. **第一批（数据损坏/崩溃）**：streaming_tiff BigTIFF 内联（350/353、730/733）+ NoData 标签、fetcher.rs 字节切片 panic、merger.rs 溢出 panic。
2. **第二批（并发/卡死）**：PauseControl 丢失唤醒、PendingDecision 变体、resume_task 活动守卫、tile_cache close() 锁内 IO。
3. **第三批（安全/可靠性）**：SourceKey 路径穿越、settings/history 原子写 + 并发锁 + 损坏回退、budget u64 溢出。
4. **第四批（错误结果）**：filter.rs transform、wayback from_timestamp 伪造日期、前端 #1/#2。
5. **第五批**：其余中/低项择机清理。

## 六、已验证良好的部分

- 进度/计数普遍用 `saturating_*`，整数安全做得好。
- 3DTiles 递归有 `visited` 去重防循环引用 + 迭代式解析，无栈溢出。
- Terrarium 解码公式正确，无溢出。
- 前端 StrictMode 双挂载、Tauri listen unlisten 清理、直辖市三段持久化、zod 数值校验等历史坑点已系统性规避。前端整体 A-。

---

## 七、人工核对修正（逐项打开源码复核）

> 在子代理扫描基础上，亲自打开真实代码逐项复核，对分级做以下修正。

| 项 | 子代理判定 | 核对后 | 修正理由 |
|---|---|---|---|
| SourceKey 路径穿越 | 高 | **中（隐患）** | 所有外部入口 `lib.rs:57`、`commands.rs:3704/3739/3802/3838`、`downloader.rs:170` 均走 `SourceKey::new()` → slugify 已净化；`SourceKey(pub)` 裸构造仅在 `pool.rs:241/324` 用于**磁盘已存在的文件名**。当前**无可达利用路径**，属防御性加固而非活 bug |
| tile_cache close() 锁内 IO | 高 | **中** | `close()` 持 `inner` 锁时调 `checkpoint_entry`（IO），而 `handle()`/`shutdown()` 正确先 `drop(inner)`。但 `close()` 仅删文件前低频调用，checkpoint 内部不再抢 `inner` 锁 → 是**阻塞**而非真死锁 |
| streaming_tiff BigTIFF 内联 | 高 | **维持高（已确认）** | streaming_tiff.rs 始终外置 StripOffsets/StripByteCounts；pyramid.rs:464 对 `num_strips==1` 正确内联，可作修复范例 |
| merger.rs:168/171 溢出 | 高 | **维持高（已确认）** | `cols = x_max - x_min + 1` 裸 u32 减；`width = cols * TILE_SIZE` 裸乘 |
| task.rs:87 丢失唤醒 | 高 | **维持高（已确认）** | `while flag { notify.notified().await }`，check 与 await 之间存在窗口 |
| resume_task:1833 缺守卫 | 高 | **维持高（已确认）** | 仅过滤 `load_resumable_tasks`，未查当前活动 HashMap；UI 快速双击 resume 真实可达 → 同 task_id 双循环写同目录 |
| history.rs:124 无锁 | 高 | **维持高（已确认）** | `add` = get_all → insert → save，无锁 read-modify-write |
| fetcher.rs:92/182/402 字节切片 | 高 | **维持高（已确认）** | `&text[..len.min(N)]` 按字节切 String，非 ASCII body panic |

**修正后高优先级数量：10（原 12，路径穿越与 close() 锁内 IO 降为中）。**

---

## 八、修复计划表

### 批次 1：数据损坏 / 崩溃（最高优先，互相独立可并行改）—— ✅ 已完成（cargo check 通过）

| # | 文件:行 | 问题 | 修复方案 | 工作量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 1.1 | streaming_tiff.rs:340-360 | BigTIFF 单 strip 未内联→损坏 TIFF | 仿 pyramid.rs:464：`if num_strips==1 { inline } else { 外置 }`，对 tag 273/279 | 小 | 低，有正确范例 | ✅ 已改：新增 `strip_offsets_field`/`strip_counts_field`，tag 273/279 改用 _field |
| 1.2 | streaming_tiff.rs:720-740 | DEM 路径同缺陷 + GDAL_NODATA(42113) 6字节错误外置 | 同上 + NoData 标签 ≤8字节内联 | 中 | 中，需 QGIS 验证 NoData | ✅ 已改：DEM 路径同 _field；NoData 用 8 字节 buf + u64::from_le_bytes 内联（tag 42113） |
| 1.3 | fetcher.rs:92,182,402 | 按字节切 String → 非 ASCII panic | `.chars().take(N).collect()` 或 char_indices 找边界 | 小 | 低 | ✅ 已改：92/182 用 `chars().take(N).collect::<String>()`；402 用 rev/take/rev 取末尾 60 字符 |
| 1.4 | merger.rs:168,171 | 裸减 + u32 溢出 | 入口校验 `x_max>=x_min` + `checked_mul` + 面积上限 Err | 小 | 低 | ✅ 已改：改用 `saturating_sub/add/mul`（返回类型仍 RgbImage，正常范围行为不变，异常输入降级不 panic） |

> 备注：1.4 因 `merge_tiles` 返回 `RgbImage`（非 Result），为不改签名/不影响调用方，采用 saturating 而非 Result+面积上限；OOM 防护交由上层 budget 检查。待 QGIS 验证 1.2 的 NoData 与单行瓦片导出。

### 批次 2：并发卡死 / 数据竞争（并发敏感，串行 + 手测）✅ 已完成（cargo check + tsc 通过）

| # | 文件:行 | 问题 | 修复方案 | 工作量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 2.1 | task.rs:87 | wait_if_paused 丢失唤醒→暂停永久卡死 | 先 `let fut = notify.notified()` 再 check flag 再 await（double-check） | 小 | 中 | ✅ 已改：double-check loop + `notified.as_mut().enable()`，规避 notify_waiters lost-wakeup |
| 2.2 | commands.rs:1833 | resume_task 缺活动守卫→双循环写同目录 | 仿 export_partial_task:2098 加活动 id 检查，已活动则拒绝 | 小 | 低 | ✅ 已改：入口检查 get_all_tasks，**仅当**任务处于「活动运行态」(Pending/Downloading/Merging/Processing/Exporting) 时 Err("任务已在进行中")。**关键修正**：原方案误用"非终态即拒绝"会误杀 PendingDecision/CompletedWithGaps 的补漏重导（这正是 resume_task 的主用途），改为只拦真正运行中的循环 |
| 2.3 | task.rs:16-29,240 | 无 PendingDecision 变体→假 Downloading 卡死 | 加 `PendingDecision` 枚举变体 + toggle_pause 排除 | 中 | 中，前端状态映射需同步 | ✅ 已改：新增 `PendingDecision`（serde `pending_decision`）；mark_pending_decision 改置该态；toggle_pause 仅处理 Downloading/Paused 自动排除；前端 api.ts/tasks-panel/tasks-dialog 同步映射（标签"待决策"、补漏/强制导出按钮、暂停切换仅 downloading/paused 显示） |
| 2.4 | task.rs:191/200/218 | complete/fail 缺终态保护，Cancelled 被覆写 | 加 `if matches!(status, Cancelled\|Failed){return}` 守卫 | 小 | 低 | ✅ 已改：complete_task/complete_task_with_gaps/mark_pending_decision/fail_task 各加终态守卫（update_progress 原已有） |

### 批次 3：可靠性 / 持久化鲁棒性（共性，可批量）✅ 已完成（cargo check 通过）

| # | 文件:行 | 问题 | 修复方案 | 工作量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 3.1 | settings.rs / history.rs / wayback*.rs | `fs::write` 非原子→崩溃截断 JSON | 抽 `atomic_write`：写 `.tmp` 再 rename | 中 | 低 | ✅ 已改：新增 `fs_util::atomic_write`（`.{name}.{pid}.tmp`→sync_all→rename）；settings/history/wayback/wayback_metadata/task save_task_file 全部接入 |
| 3.2 | history.rs:124 | add 无锁 read-modify-write→丢记录 | Mutex 包裹 read-modify-write | 小 | 低 | ✅ 已改：HistoryManager 加 `std::sync::Mutex<()>`，add/delete/clear/update 入口取锁 |
| 3.3 | settings/history get | 部分损坏 JSON 直接 Err 无回退 | 解析失败→备份 `.corrupt` + 回退默认 | 小 | 低 | ✅ 已改：get 解析失败 → rename 到 `.json.corrupt` + log::warn + 回退默认/空集 |
| 3.4 | budget.rs:191 | u64 乘法溢出→预算误放行 OOM | `checked_mul` 链，溢出→饱和 u64::MAX | 小 | 低 | ✅ 已改：pixel_bytes 改 checked_mul 链 + unwrap_or(u64::MAX) |
| 3.5 | tile_cache mod.rs:20 | SourceKey(pub) 隐患 | 字段私有化 + 仅暴露 `new()`；pool.rs 改内部构造器 | 小 | 低（加固） | ✅ 已改：字段私有 + `pub(crate) from_slug`；pool.rs 两处元组构造改 from_slug |

### 批次 4：错误结果（功能性，独立）

| # | 文件:行 | 问题 | 修复方案 | 工作量 | 风险 |
|---|---|---|---|---|---|
| 4.1 | filter.rs:205-280 | box/sphere 忽略 tile.transform→过滤系统性错误 | 逐级累乘 transform 矩阵后再 ecef_to_lonlat | 大 | 高，需 3DTiles 样本验证 |
| 4.2 | wayback_metadata.rs:651 | from_timestamp 失败伪造 now()→污染去重 | 解析失败→跳过该 feature | 小 | 低 |
| 4.3 | wayback.rs:300 | lat_lng_to_tile 无边界裁剪 | clamp 到 `0..=n-1` | 小 | 低 |
| 4.4 | 前端 wayback-page.tsx:148 | scanAbortRef 死代码 + 轮询无卸载清理 | useEffect cleanup 置 abort=true | 小 | 低 |
| 4.5 | 前端 update-dialog.tsx:84 | 成功路径不复位 downloading→对话框卡死 | finally 复位 downloading | 小 | 低 |

### 批次 5：中低优先（择机）
streaming_tiff/raster 扫描线 i32→i64、width u32 溢出；merger.rs:347 越界；tile_cache LRU 淘汰在用连接 / busy_timeout / active_downloads 全局计数；fetcher.rs:742 .tmp 碰撞；tileset.rs geometric_error 加 serde default；admin.rs JSON 转义；commands.rs 历史重复写入 / 导出阶段取消检查 等。

### 执行节奏建议
1. 批次 1 优先（4 项独立，一次改完 `cargo check`）——消除损坏文件与 panic
2. 批次 2 单独一轮（改完手测 暂停/恢复/重复 resume）
3. 批次 3、4 各一轮
4. 全部 `cargo check` 通过后视情况发 v3.5.3
