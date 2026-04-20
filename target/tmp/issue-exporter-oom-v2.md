## 背景

代码安全审计发现 C3/C4 — `exporter` + `merger` 在大区域下载时存在严重 OOM 风险。当前 `max_tiles=500_000` 理论最大画布占用 **~98 GB**，50,000 瓦片场景已需 ~10 GB。

GeoTIFF 已有部分流式路径（`streaming_tiff`），但仅在 **瓦片数 > 5000 且无多边形裁剪** 时启用。PNG/JPEG/裁剪 GeoTIFF 全部走全量内存路径，存在用户实际可触发的崩溃风险。

## 风险点摘要（详见 RFC）

| ID | 位置 | 50k 瓦片峰值 | 触发 |
|----|------|-------------|------|
| R1 致命 | merger.rs `RgbImage::from_pixel` | ~9.9 GB | PNG/JPEG/小TIFF/裁剪TIFF |
| R2 高 | merger.rs RGB+RGBA 双持 | ~23.1 GB | 多边形裁剪 |
| R3 高 | exporter.rs `image.clone()` | ~28-31 GB | 多边形裁剪 + PNG/JPEG |
| R4 中 | commands.rs 画布+编码同持 | ~19.8 GB | 大无压缩 TIFF |
| R5 低 | streaming_tiff strip+compressed | ~290 MB | 流式 GeoTIFF（可控）|
| R6 设计 | `max_tiles` 仅校验数量 | 理论 98 GB | 上限设计缺陷 |

## 技术方案

详见 [`docs/exporter-oom-fix-design.md`](https://github.com/gaopengbin/geo-downloader/blob/main/docs/exporter-oom-fix-design.md)

**总策略**：流式优先 + 内存预算 + 必要时分块

## 实施里程碑

### OOM 修复（M1-M4）

- **M1** 内存预算守卫（1 天）：从源头止血，超预算请求早返回
- **M2** 流式路径扩展（2 天）：去掉 5k 门槛 + 裁剪 GeoTIFF 流式
- **M3** PNG/JPEG 流式编码（2 天）：消灭 R1 在非 TIFF 路径
- **M4** 裁剪原地转换（1 天）：消灭 R2/R3 双倍驻留

### 合成性能优化（M5）

- **M5.1** rayon strip 内并行解码（0.5 天）：预期 4-6× 加速（全格式通吃）
- **M5.2** 双缓冲流水线（0.5 天）：再 1.3-1.5× 加速

组合预期：50k 瓦片合成 10 min → ~1.5 min

总计 ~7 个工作日，5 个独立可上线 PR。

## 决策记录

- **不引入 spng FFI**：Rust 绑定 5 年无人维护（v0.1.0），C 依赖增加构建复杂度 + 安全面；纯 Rust `zune-png` 可达相当性能
- **不引入 turbojpeg FFI**：同理 C 依赖成本高；rayon 并行解码已覆盖 JPEG 瓦片源加速需求
- **优先 rayon 并行而非单线程解码器替换**：并行 4-6× 是全格式通吃的杠杆，zune-png/turbojpeg 各仅覆盖单一输入格式
- **后续评估项**（v3.4）：升级 image crate（含 fdeflate）、zune-png 基准测试、GPU 解码

## 验收标准

- [ ] 50k 瓦片 + GeoTIFF + 多边形裁剪：内存峰值 < 1 GB
- [ ] 50k 瓦片 + PNG（无裁剪）：内存峰值 < 1 GB
- [ ] 200k 瓦片 + PNG：早返回友好错误，提示用户改流式 TIFF 或缩小区域
- [ ] 50k 瓦片合成耗时降低 5× 以上
- [ ] 单元测试：`peak_multiplier` 8 组用例 + 边界条件
- [ ] 现有任务缓存兼容：v3.2.x 已下载瓦片可正常导出
- [ ] 设置项 `memory_budget_mb` 默认 2048，可在 UI 调整

## 关联

- 来源：2026-04-17 安全审计 C3/C4
- RFC: `docs/exporter-oom-fix-design.md`
- 工作日志: `docs/worklog/2026-04-17-security-fixes-and-rfcs.md`
- 目标版本：v3.3.0
