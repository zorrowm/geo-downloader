# v3.5.3 — 全盘 bug 扫描修复（导出 / 暂停 / 并发 / 持久化）

对 v3.5.2 后的代码做了一轮全盘只读扫描，修复其中会直接影响使用的高/中危问题，覆盖数据损坏、崩溃、并发卡死、持久化截断四类。cargo check / tsc 均通过。

## 数据损坏 / 崩溃

- **默认导出路径不再因坐标范围异常崩溃或写出损坏文件**
  GeoTIFF / PNG / DEM 走的流式导出此前用裸 `x_max - x_min` 和 `cols * TILE_SIZE`：坐标反转（如跨反经线 / swapped bounds）会触发 u32 减法 panic、超大区域会 u32 乘法溢出写出尺寸错乱的损坏文件。新增入口校验，异常输入返回明确错误而非崩溃（此前的 saturating 修复只覆盖了 JPEG 路径，这次补齐常用路径）。

- **单行瓦片导出的 BigTIFF 不再损坏**
  单 strip 时 StripOffsets / StripByteCounts（LONG8，≤8 字节）按 BigTIFF 规范改为内联到 value 字段，否则解析器把外部偏移当数据，生成损坏的 TIFF。

- **DEM NoData 重新生效**
  DEM 路径的 GDAL_NODATA(42113) 6 字节 ASCII 此前错误外置，导致 GDAL / QGIS 读不到 NoData、`-9999` 被当作真实高程；改为内联。

- **非 ASCII 服务器响应不再 panic**
  3DTiles 抓取日志按字节切 String，遇到中文 / UTF-8 body 会在字符边界处 panic；改为按字符截断。

## 并发卡死 / 数据竞争

- **暂停后不再永久卡死**
  `PauseControl` 先登记 Notify waiter 再检查标志位，修复 `notify_waiters` 丢失唤醒导致暂停后无法恢复的竞态。

- **新增"待决策"任务状态**
  成功率过低跳过自动导出的任务此前复用"暂停"态，会被暂停/恢复开关误操作成假"下载中"卡死。现独立为"待决策"，提供补漏重试 / 强制导出入口，暂停切换仅对真正下载中 / 暂停的任务显示。

- **快速二次"恢复"不再写坏文件**
  `resume_task` 增加活动守卫：任务正在运行时拒绝二次启动，避免两个下载循环同时写同一目录；暂停 / 待决策 / 缺块完成的任务仍可正常恢复。

## 持久化鲁棒性

- **配置 / 历史 / 状态文件原子写入**
  settings / history / wayback / 任务文件改为先写临时文件再 rename，避免进程崩溃或断电时产生半截 JSON。
- **历史记录并发写入不再丢记录**：add / update / delete / clear 串行化。
- **损坏的 JSON 自动备份回退**：解析失败时备份为 `.corrupt` 并回退默认值，避免功能不可用。

## 前端

- **Wayback 时间轴不再触发无限渲染**
  统一 settings 查询 key，且仅在预览版本为空时自动选最新，避免与 Wayback 页面双向同步互相覆写导致的 setState 无限循环（React #185）。

- **"清除选区"一并重置行政区划下拉**
  此前清除选区只清地图选区，省 / 市 / 区三段下拉仍显示之前选中的区划；现在一并重置。

## 不影响

下载主流程 / 缓存命中逻辑 / 重试策略 / Issue #32 raw tiles 直写 / Issue #31 阈值机制。

---

**完整变更**：https://github.com/gaopengbin/geo-downloader/compare/v3.5.2...v3.5.3
