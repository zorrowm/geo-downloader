//! Tauri commands 模块

use crate::config::{self, TileSource};
use crate::tile::{self, Bounds};
use crate::downloader::TileDownloader;
use crate::merger;
use crate::exporter::{self, ExportFormat};
use crate::streaming_tiff;
use crate::admin::{self, AdminRegion, GeocodeResult};
use crate::history::{DownloadRecord, DownloadStatus, HistoryManager};
use crate::settings::{AppSettings, SettingsManager};
use crate::task::{TaskManager, TaskInfo, TaskLog, TaskStatus, PersistedTask, PauseControl};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// 下载请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub bounds: Bounds,
    pub zoom: u8,
    pub source: String,
    pub format: String,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub crop_to_shape: bool,
    /// 多边形列表（支持 MultiPolygon：多个不连续的面）
    #[serde(default)]
    pub polygon: Option<Vec<Vec<PolygonCoord>>>,
    #[serde(default)]
    pub tianditu_token: Option<String>,
    /// 保存路径 (如果提供，直接保存到文件)
    #[serde(default)]
    pub save_path: Option<String>,
    /// 并发数 (10-100, 默认30)
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    /// TIFF 压缩 (默认 true)
    #[serde(default = "default_compress")]
    pub compress: bool,
}

fn default_concurrency() -> usize {
    30
}

fn default_compress() -> bool {
    true
}

/// 多边形坐标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolygonCoord {
    pub lat: f64,
    pub lng: f64,
}

/// 下载估算结果
#[derive(Debug, Clone, Serialize)]
pub struct EstimateResult {
    pub tile_count: u32,
    pub estimated_size_mb: f64,
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}


/// 将 CustomTileSource 转换为 TileSource
fn custom_to_tile_source(cs: &crate::settings::CustomTileSource, attribution: &str) -> TileSource {
    let subdomains: Vec<String> = if cs.subdomains.is_empty() {
        vec![]
    } else {
        cs.subdomains.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };
    TileSource {
        id: cs.id.clone(),
        name: cs.name.clone(),
        url: cs.url.clone(),
        subdomains,
        max_zoom: cs.max_zoom,
        attribution: attribution.to_string(),
    }
}

/// 获取瓦片图源列表（内置 + 覆盖 + 自定义）
#[tauri::command]
pub fn get_tile_sources(tianditu_token: Option<String>) -> HashMap<String, TileSource> {
    let mut sources = config::get_tile_sources(tianditu_token.as_deref());
    
    if let Ok(manager) = SettingsManager::new() {
        if let Ok(settings) = manager.get() {
            // 应用内置图源覆盖配置
            for ovr in &settings.source_overrides {
                let attr = sources.get(&ovr.id)
                    .map(|s| s.attribution.clone())
                    .unwrap_or_default();
                sources.insert(ovr.id.clone(), custom_to_tile_source(ovr, &attr));
            }
            
            // 合并自定义图源
            for cs in &settings.custom_sources {
                sources.insert(cs.id.clone(), custom_to_tile_source(cs, "自定义图源"));
            }
        }
    }
    
    sources
}

/// 获取内置图源原始默认配置（用于前端重置）
#[tauri::command]
pub fn get_builtin_sources(tianditu_token: Option<String>) -> HashMap<String, TileSource> {
    config::get_tile_sources(tianditu_token.as_deref())
}

/// 估算下载大小
#[tauri::command]
pub fn estimate_download(bounds: Bounds, zoom: u8) -> EstimateResult {
    let tile_count = tile::estimate_tile_count(&bounds, zoom);
    let avg_tile_size_kb = 20.0;
    let estimated_size_mb = (tile_count as f64 * avg_tile_size_kb) / 1024.0;
    
    let max_tiles = 500_000u32;
    
    if tile_count > max_tiles {
        EstimateResult {
            tile_count,
            estimated_size_mb,
            allowed: false,
            warning: Some(format!("区域过大（{} 个瓦片），超过 {} 个上限。请缩小区域或降低缩放级别。", tile_count, max_tiles)),
        }
    } else {
        EstimateResult {
            tile_count,
            estimated_size_mb,
            allowed: true,
            warning: None,
        }
    }
}

/// 创建下载任务的返回值
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResult {
    pub task_id: String,
    pub tile_count: u32,
}

/// 创建下载任务（非阻塞，立即返回 task_id）
#[tauri::command]
pub async fn create_download_task(
    app: AppHandle,
    task_manager: State<'_, Arc<TaskManager>>,
    request: DownloadRequest,
    task_name: String,
    source_name: String,
) -> Result<CreateTaskResult, String> {
    let save_path = request.save_path.clone()
        .ok_or_else(|| "未指定保存路径".to_string())?;
    
    // 获取图源配置（包含覆盖 + 自定义图源）
    let sources = get_tile_sources(request.tianditu_token.clone());
    let source = sources.get(&request.source)
        .ok_or_else(|| format!("未知图源: {}", request.source))?.clone();
    
    // 估算瓦片数
    let tile_count = tile::estimate_tile_count(&request.bounds, request.zoom);
    
    // 生成任务 ID
    let task_id = uuid::Uuid::new_v4().to_string();
    
    // 持久化任务（用于断点续传）
    let persisted = PersistedTask {
        task_id: task_id.clone(),
        task_name: task_name.clone(),
        source_name: source_name.clone(),
        request: request.clone(),
        tile_count,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    crate::task::save_task_file(&persisted)?;
    
    // 注册任务
    let (cancel_token, pause_control) = task_manager.create_task(
        task_id.clone(),
        task_name.clone(),
        request.source.clone(),
        source_name.clone(),
        request.zoom,
        request.format.clone(),
        save_path.clone(),
        tile_count,
    );
    
    // spawn 后台任务
    let tm = Arc::clone(&task_manager);
    let tid = task_id.clone();
    
    tokio::spawn(async move {
        let result = execute_download_task(
            &app, &tm, &tid, &cancel_token, &pause_control,
            request, source, save_path.clone(),
            tile_count, &task_name, &source_name,
        ).await;
        
        match result {
            Ok(_) => {},
            Err(e) => {
                if tm.is_cancelled(&tid) {
                    task_log(&app, &tm, &tid, "WARN", "任务已取消");
                    crate::task::remove_task_file(&tid);
                    crate::task::cleanup_temp_dir(&tid);
                    tm.mark_cancelled(&tid);
                    let _ = app.emit(&format!("task-progress-{}", tid), TaskProgressPayload {
                        task_id: tid,
                        status: "cancelled".to_string(),
                        progress: 0.0,
                        completed: 0,
                        total: tile_count,
                        message: Some("已取消".to_string()),
                    });
                } else {
                    task_log(&app, &tm, &tid, "ERROR", &format!("任务失败: {}", e));
                    tm.fail_task(&tid, e.clone());
                    let _ = app.emit(&format!("task-progress-{}", tid), TaskProgressPayload {
                        task_id: tid,
                        status: "failed".to_string(),
                        progress: 0.0,
                        completed: 0,
                        total: tile_count,
                        message: Some(format!("失败: {}", e)),
                    });
                }
            }
        }
    });
    
    Ok(CreateTaskResult { task_id, tile_count })
}

/// 任务进度事件负载
#[derive(Debug, Clone, Serialize)]
pub struct TaskProgressPayload {
    pub task_id: String,
    pub status: String,
    pub progress: f64,
    pub completed: u32,
    pub total: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 任务日志辅助函数：追加日志 + emit 事件到前端
fn task_log(app: &AppHandle, tm: &Arc<TaskManager>, task_id: &str, level: &str, msg: &str) {
    if let Some(log) = tm.append_log(task_id, level, msg) {
        let _ = app.emit(&format!("task-log-{}", task_id), &log);
    }
}

/// 执行下载任务的核心逻辑
async fn execute_download_task(
    app: &AppHandle,
    tm: &Arc<TaskManager>,
    task_id: &str,
    cancel_token: &tokio_util::sync::CancellationToken,
    pause_control: &PauseControl,
    request: DownloadRequest,
    source: TileSource,
    save_path: String,
    _tile_count: u32,
    task_name: &str,
    source_name: &str,
) -> Result<(), String> {
    let event_name = format!("task-progress-{}", task_id);
    let start_time = std::time::Instant::now();
    
    // 记录任务参数
    task_log(app, tm, task_id, "INFO", &format!("=== 任务开始: {} ===", task_name));
    task_log(app, tm, task_id, "INFO", &format!("图源: {} ({})", source_name, request.source));
    task_log(app, tm, task_id, "INFO", &format!("缩放级别: z{}", request.zoom));
    task_log(app, tm, task_id, "INFO", &format!("输出格式: {}", request.format));
    task_log(app, tm, task_id, "INFO", &format!("保存路径: {}", save_path));
    task_log(app, tm, task_id, "INFO", &format!("并发数: {}", request.concurrency));
    if request.crop_to_shape {
        task_log(app, tm, task_id, "INFO", "启用边界裁剪");
    }
    if request.compress {
        task_log(app, tm, task_id, "INFO", "启用 LZW 压缩");
    }
    
    // 获取瓦片列表
    let tiles = tile::get_tiles_in_bounds(&request.bounds, request.zoom);
    let actual_count = tiles.len() as u32;
    let (x_min, y_min, x_max, y_max, _, _) = tile::get_tile_matrix_size(&request.bounds, request.zoom);
    task_log(app, tm, task_id, "INFO", &format!("瓦片数量: {}，矩阵范围: x[{}-{}] y[{}-{}]", actual_count, x_min, x_max, y_min, y_max));
    
    // 创建临时目录
    let temp_dir = std::env::temp_dir().join(format!("tif-dl-{}", task_id));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;
    
    // 创建下载器
    let downloader = TileDownloader::new(source, request.proxy.as_deref())?;
    
    // 更新状态: 下载中
    task_log(app, tm, task_id, "INFO", "开始下载瓦片...");
    tm.update_progress(task_id, TaskStatus::Downloading, 0.0, 0, 0, Some("开始下载...".to_string()));
    
    let app_c = app.clone();
    let en = event_name.clone();
    let tid = task_id.to_string();
    let tm_c = Arc::clone(tm);
    let concurrency = request.concurrency;
    let mut last_log_pct: f64 = 0.0;
    
    let mut last_status = String::new();
    
    let tile_files = downloader.download_tiles(tiles, concurrency, &temp_dir, Some(cancel_token), Some(pause_control), move |progress| {
        let p = progress.percent();
        // 映射到 0-85% 范围
        let mapped = p * 0.85;
        
        // 检测重试状态变化，记录日志
        let is_retry = progress.status != "downloading" && progress.status != "completed" && progress.status != "completed_with_errors";
        if progress.status != last_status {
            last_status = progress.status.clone();
            if let Some(log) = tm_c.append_log(&tid, if is_retry { "WARN" } else { "INFO" }, &progress.status) {
                let _ = app_c.emit(&format!("task-log-{}", tid), &log);
            }
        }
        
        let display_msg = if is_retry {
            format!("{} ({}/{})", progress.status, progress.completed, progress.total)
        } else {
            format!("下载中 {}/{}", progress.completed, progress.total)
        };
        
        tm_c.update_progress(&tid, TaskStatus::Downloading, mapped, progress.completed, progress.failed, Some(display_msg.clone()));
        let _ = app_c.emit(&en, TaskProgressPayload {
            task_id: tid.clone(),
            status: "downloading".to_string(),
            progress: mapped,
            completed: progress.completed,
            total: progress.total,
            message: Some(display_msg),
        });
        // 每10%记录一次日志
        if p - last_log_pct >= 10.0 {
            last_log_pct = (p / 10.0).floor() * 10.0;
            if let Some(log) = tm_c.append_log(&tid, "INFO", &format!("下载进度 {:.0}% ({}/{})", p, progress.completed, progress.total)) {
                let _ = app_c.emit(&format!("task-log-{}", tid), &log);
            }
        }
    }).await?;
    
    // 检查取消
    if cancel_token.is_cancelled() {
        return Err("任务已取消".to_string());
    }
    
    let failed_count = actual_count - tile_files.len() as u32;
    let download_elapsed = start_time.elapsed();
    task_log(app, tm, task_id, "INFO", &format!("下载完成，成功 {} 张，失败 {} 张，耗时 {:.1}s", tile_files.len(), failed_count, download_elapsed.as_secs_f64()));
    
    // 判断是否使用流式写入路径 (GeoTIFF + 瓦片数 > 5000)
    let is_geotiff = ExportFormat::from_str(&request.format) == ExportFormat::GeoTiff;
    let use_streaming = is_geotiff && actual_count > 5_000
        && !(request.crop_to_shape && request.polygon.is_some());
    
    let file_size;
    
    if use_streaming {
        // ===== 流式 GeoTIFF 路径：逐行写入，内存极低 =====
        task_log(app, tm, task_id, "INFO", &format!("使用流式 BigTIFF 导出（{} 张瓦片）", actual_count));
        tm.update_progress(task_id, TaskStatus::Exporting, 88.0, actual_count - failed_count, failed_count, Some("流式导出 GeoTIFF...".to_string()));
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: task_id.to_string(),
            status: "exporting".to_string(),
            progress: 88.0,
            completed: actual_count - failed_count,
            total: actual_count,
            message: Some("流式导出 GeoTIFF...".to_string()),
        });
        
        let merged_bounds = tile::get_merged_bounds(x_min, y_min, x_max, y_max, request.zoom);
        let sp = save_path.clone();
        
        file_size = tokio::task::spawn_blocking(move || {
            streaming_tiff::merge_and_export_streaming(
                &tile_files, x_min, y_min, x_max, y_max,
                &merged_bounds, Path::new(&sp),
            )
        }).await.map_err(|e| format!("流式导出失败: {}", e))??;
    } else {
        // ===== 常规路径：内存拼接 + 导出 =====
        task_log(app, tm, task_id, "INFO", "使用常规内存拼接路径");
        task_log(app, tm, task_id, "INFO", "开始拼接瓦片...");
        tm.update_progress(task_id, TaskStatus::Merging, 88.0, actual_count - failed_count, failed_count, Some("拼接中...".to_string()));
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: task_id.to_string(),
            status: "merging".to_string(),
            progress: 88.0,
            completed: actual_count - failed_count,
            total: actual_count,
            message: Some("拼接瓦片...".to_string()),
        });
        
        let merged = tokio::task::spawn_blocking(move || {
            merger::merge_tiles(&tile_files, x_min, y_min, x_max, y_max)
        }).await.map_err(|e| format!("拼接失败: {}", e))?;
        
        if cancel_token.is_cancelled() {
            return Err("任务已取消".to_string());
        }
        
        task_log(app, tm, task_id, "INFO", &format!("拼接完成，开始导出 {}...", request.format.to_uppercase()));
        tm.update_progress(task_id, TaskStatus::Exporting, 93.0, actual_count - failed_count, failed_count, Some("导出中...".to_string()));
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: task_id.to_string(),
            status: "exporting".to_string(),
            progress: 93.0,
            completed: actual_count - failed_count,
            total: actual_count,
            message: Some(format!("导出 {}...", request.format.to_uppercase())),
        });
        
        let merged_bounds = tile::get_merged_bounds(x_min, y_min, x_max, y_max, request.zoom);
        let format = ExportFormat::from_str(&request.format);
        let crop_to_shape = request.crop_to_shape;
        let polygon_opt = request.polygon.clone();
        // 使用瓦片网格边界（而非用户选区）做多边形裁剪的坐标参考
        let grid_bounds_tuple = (merged_bounds.north, merged_bounds.south, merged_bounds.east, merged_bounds.west);
        let compress = request.compress;
        
        let bytes = tokio::task::spawn_blocking(move || {
            if crop_to_shape && polygon_opt.is_some() {
                let polygons: Vec<Vec<merger::PolygonPoint>> = polygon_opt.unwrap()
                    .iter()
                    .map(|ring| ring.iter().map(|p| merger::PolygonPoint { lat: p.lat, lng: p.lng }).collect())
                    .collect();
                let masked = merger::mask_image_by_polygons(&merged, &polygons, grid_bounds_tuple);
                exporter::export_rgba_image(&masked, format, Some(&merged_bounds), compress)
            } else {
                exporter::export_image(&merged, format, Some(&merged_bounds), compress)
            }
        }).await.map_err(|e| format!("导出失败: {}", e))??;
        
        file_size = bytes.len() as u64;
        std::fs::write(&save_path, &bytes)
            .map_err(|e| format!("保存文件失败: {}", e))?;
    }
    
    // 标记完成，清理临时文件和持久化任务
    let total_elapsed = start_time.elapsed();
    let size_mb = file_size as f64 / 1024.0 / 1024.0;
    task_log(app, tm, task_id, "INFO", &format!("=== 任务完成 === 文件大小: {:.1} MB，总耗时: {:.1}s", size_mb, total_elapsed.as_secs_f64()));
    crate::task::remove_task_file(task_id);
    crate::task::cleanup_temp_dir(task_id);
    tm.complete_task(task_id, file_size);
    let _ = app.emit(&event_name, TaskProgressPayload {
        task_id: task_id.to_string(),
        status: "completed".to_string(),
        progress: 100.0,
        completed: actual_count - failed_count,
        total: actual_count,
        message: Some("完成!".to_string()),
    });
    
    // 自动添加历史记录
    let record = DownloadRecord::new(
        task_name.to_string(),
        request.source.clone(),
        source_name.to_string(),
        request.zoom,
        request.format.clone(),
        save_path,
        file_size,
        actual_count,
        failed_count,
        if failed_count == 0 { DownloadStatus::Completed } else { DownloadStatus::Completed },
    );
    if let Ok(manager) = HistoryManager::new() {
        let _ = manager.add(record);
    }
    
    Ok(())
}

/// 获取所有活动任务
#[tauri::command]
pub fn get_active_tasks(task_manager: State<'_, Arc<TaskManager>>) -> Vec<TaskInfo> {
    task_manager.get_all_tasks()
}

/// 获取任务日志
#[tauri::command]
pub fn get_task_logs(task_manager: State<'_, Arc<TaskManager>>, task_id: String) -> Vec<TaskLog> {
    task_manager.get_logs(&task_id)
}

/// 取消任务
#[tauri::command]
pub fn cancel_task(task_manager: State<'_, Arc<TaskManager>>, task_id: String) -> bool {
    task_manager.cancel_task(&task_id)
}

/// 暂停/恢复任务
#[tauri::command]
pub fn toggle_pause_task(
    app: AppHandle,
    task_manager: State<'_, Arc<TaskManager>>,
    task_id: String,
) -> bool {
    let (ok, paused) = task_manager.toggle_pause(&task_id);
    if ok {
        let status = if paused { "paused" } else { "downloading" };
        let msg = if paused { "已暂停" } else { "已恢复下载" };
        task_log(&app, &task_manager, &task_id, "INFO", msg);
        let _ = app.emit(&format!("task-progress-{}", task_id), TaskProgressPayload {
            task_id: task_id.clone(),
            status: status.to_string(),
            progress: 0.0, // 前端会保留当前进度
            completed: 0,
            total: 0,
            message: Some(msg.to_string()),
        });
    }
    ok
}

/// 移除已完成的任务
#[tauri::command]
pub fn remove_task(task_manager: State<'_, Arc<TaskManager>>, task_id: String) {
    task_manager.remove_finished(&task_id);
}

// ============ 断点续传相关命令 ============

/// 获取可恢复的任务列表（排除当前活动任务）
#[tauri::command]
pub fn get_resumable_tasks(task_manager: State<'_, Arc<TaskManager>>) -> Vec<PersistedTask> {
    let active_ids: std::collections::HashSet<String> = task_manager
        .get_all_tasks()
        .into_iter()
        .map(|t| t.id)
        .collect();
    crate::task::load_resumable_tasks()
        .into_iter()
        .filter(|t| !active_ids.contains(&t.task_id))
        .collect()
}

/// 恢复下载任务
#[tauri::command]
pub async fn resume_task(
    app: AppHandle,
    task_manager: State<'_, Arc<TaskManager>>,
    task_id: String,
) -> Result<CreateTaskResult, String> {
    // 读取持久化任务
    let tasks = crate::task::load_resumable_tasks();
    let persisted = tasks.into_iter()
        .find(|t| t.task_id == task_id)
        .ok_or_else(|| "未找到可恢复的任务".to_string())?;
    
    let request = persisted.request.clone();
    let task_name = persisted.task_name.clone();
    let source_name = persisted.source_name.clone();
    let tile_count = persisted.tile_count;
    let save_path = request.save_path.clone()
        .ok_or_else(|| "未指定保存路径".to_string())?;
    
    let sources = get_tile_sources(request.tianditu_token.clone());
    let source = sources.get(&request.source)
        .ok_or_else(|| format!("未知图源: {}", request.source))?.clone();
    
    // 注册任务（复用原 task_id）
    let (cancel_token, pause_control) = task_manager.create_task(
        task_id.clone(),
        task_name.clone(),
        request.source.clone(),
        source_name.clone(),
        request.zoom,
        request.format.clone(),
        save_path.clone(),
        tile_count,
    );
    
    let tm = Arc::clone(&task_manager);
    let tid = task_id.clone();
    
    tokio::spawn(async move {
        let result = execute_download_task(
            &app, &tm, &tid, &cancel_token, &pause_control,
            request, source, save_path.clone(),
            tile_count, &task_name, &source_name,
        ).await;
        
        match result {
            Ok(_) => {},
            Err(e) => {
                if tm.is_cancelled(&tid) {
                    task_log(&app, &tm, &tid, "WARN", "任务已取消");
                    crate::task::remove_task_file(&tid);
                    crate::task::cleanup_temp_dir(&tid);
                    tm.mark_cancelled(&tid);
                    let _ = app.emit(&format!("task-progress-{}", tid), TaskProgressPayload {
                        task_id: tid,
                        status: "cancelled".to_string(),
                        progress: 0.0, completed: 0, total: tile_count,
                        message: Some("已取消".to_string()),
                    });
                } else {
                    task_log(&app, &tm, &tid, "ERROR", &format!("任务失败: {}", e));
                    tm.fail_task(&tid, e.clone());
                    let _ = app.emit(&format!("task-progress-{}", tid), TaskProgressPayload {
                        task_id: tid,
                        status: "failed".to_string(),
                        progress: 0.0, completed: 0, total: tile_count,
                        message: Some(format!("失败: {}", e)),
                    });
                }
            }
        }
    });
    
    Ok(CreateTaskResult { task_id, tile_count })
}

/// 丢弃可恢复的任务
#[tauri::command]
pub fn discard_resumable_task(task_id: String) {
    crate::task::remove_task_file(&task_id);
    crate::task::cleanup_temp_dir(&task_id);
}

/// 获取省份列表
#[tauri::command]
pub fn get_provinces() -> Vec<AdminRegion> {
    admin::get_provinces()
}

/// 获取城市列表
#[tauri::command]
pub async fn get_cities(province_code: String) -> Result<Vec<AdminRegion>, String> {
    admin::get_cities(&province_code).await
}

/// 获取区县列表
#[tauri::command]
pub async fn get_districts(city_code: String) -> Result<Vec<AdminRegion>, String> {
    admin::get_districts(&city_code).await
}

/// 获取行政区边界 GeoJSON
/// to_wgs84: 是否转换为 WGS-84 坐标系（默认 true，Google 地图等 GCJ-02 图源应传 false）
#[tauri::command]
pub async fn get_admin_boundary(code: String, to_wgs84: Option<bool>) -> Result<serde_json::Value, String> {
    admin::get_admin_boundary(&code, to_wgs84.unwrap_or(true)).await
}

/// 地名搜索
#[tauri::command]
pub async fn geocode_search(query: String) -> Result<Vec<GeocodeResult>, String> {
    admin::geocode_search(&query).await
}

// ============ 历史记录相关命令 ============

/// 获取下载历史记录
#[tauri::command]
pub fn get_download_history() -> Result<Vec<DownloadRecord>, String> {
    let manager = HistoryManager::new()?;
    manager.get_all()
}

/// 添加下载记录
#[tauri::command]
pub fn add_download_record(
    name: String,
    source: String,
    source_name: String,
    zoom: u8,
    format: String,
    file_path: String,
    file_size: u64,
    tile_count: u32,
    failed_count: u32,
    success: bool,
) -> Result<DownloadRecord, String> {
    let status = if success { DownloadStatus::Completed } else { DownloadStatus::Failed };
    let record = DownloadRecord::new(
        name, source, source_name, zoom, format, file_path, file_size, tile_count, failed_count, status
    );
    
    let manager = HistoryManager::new()?;
    manager.add(record.clone())?;
    Ok(record)
}

/// 删除下载记录
#[tauri::command]
pub fn delete_download_record(id: String) -> Result<(), String> {
    let manager = HistoryManager::new()?;
    manager.delete(&id)
}

/// 清空所有下载记录
#[tauri::command]
pub fn clear_download_history() -> Result<(), String> {
    let manager = HistoryManager::new()?;
    manager.clear()
}

/// 打开文件所在目录
#[tauri::command]
pub fn open_file_location(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    // 获取父目录
    let dir = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    
    open::that(dir)
        .map_err(|e| format!("打开文件夹失败: {}", e))
}

/// 打开文件
#[tauri::command]
pub fn open_file(file_path: String) -> Result<(), String> {
    open::that(&file_path)
        .map_err(|e| format!("打开文件失败: {}", e))
}

// ============ 设置相关命令 ============

/// 获取应用设置
#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let manager = SettingsManager::new()?;
    manager.get()
}

/// 保存应用设置
#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let manager = SettingsManager::new()?;
    manager.save(&settings)
}

// ============ 矢量数据下载命令 ============

/// 创建 OSM 矢量数据下载任务（非阻塞）
#[tauri::command]
pub async fn create_osm_download_task(
    app: AppHandle,
    task_manager: State<'_, Arc<TaskManager>>,
    bounds: Bounds,
    feature_type: String,
    save_path: String,
    proxy: Option<String>,
    polygon: Option<Vec<PolygonCoord>>,
    task_name: String,
) -> Result<CreateTaskResult, String> {
    use crate::admin::download_osm_features;

    let task_id = uuid::Uuid::new_v4().to_string();

    let (cancel_token, _pause_control) = task_manager.create_task(
        task_id.clone(),
        task_name.clone(),
        "osm_vector".to_string(),
        "OSM Overpass".to_string(),
        0,
        "geojson".to_string(),
        save_path.clone(),
        0,
    );

    let tm = Arc::clone(&task_manager);
    let tid = task_id.clone();

    tokio::spawn(async move {
        let event_name = format!("task-progress-{}", tid);

        // 请求中
        tm.update_progress(&tid, TaskStatus::Downloading, 20.0, 0, 0, Some("正在请求 Overpass API...".to_string()));
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: tid.clone(), status: "downloading".to_string(),
            progress: 20.0, completed: 0, total: 0,
            message: Some("正在请求 Overpass API...".to_string()),
        });

        let poly_coords: Option<Vec<(f64, f64)>> = polygon.map(|p| p.iter().map(|c| (c.lat, c.lng)).collect());

        let geojson = match download_osm_features(
            bounds.south, bounds.west, bounds.north, bounds.east,
            &feature_type, proxy.as_deref(), poly_coords.as_deref(),
        ).await {
            Ok(g) => g,
            Err(e) => {
                if tm.is_cancelled(&tid) {
                    tm.mark_cancelled(&tid);
                    let _ = app.emit(&event_name, TaskProgressPayload {
                        task_id: tid, status: "cancelled".to_string(),
                        progress: 0.0, completed: 0, total: 0, message: Some("已取消".to_string()),
                    });
                } else {
                    tm.fail_task(&tid, e.clone());
                    let _ = app.emit(&event_name, TaskProgressPayload {
                        task_id: tid, status: "failed".to_string(),
                        progress: 0.0, completed: 0, total: 0, message: Some(format!("失败: {}", e)),
                    });
                }
                return;
            }
        };

        if cancel_token.is_cancelled() {
            tm.mark_cancelled(&tid);
            let _ = app.emit(&event_name, TaskProgressPayload {
                task_id: tid, status: "cancelled".to_string(),
                progress: 0.0, completed: 0, total: 0, message: Some("已取消".to_string()),
            });
            return;
        }

        // 保存文件
        tm.update_progress(&tid, TaskStatus::Exporting, 80.0, 0, 0, Some("保存文件...".to_string()));
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: tid.clone(), status: "exporting".to_string(),
            progress: 80.0, completed: 0, total: 0, message: Some("保存文件...".to_string()),
        });

        let content = match serde_json::to_string_pretty(&geojson) {
            Ok(c) => c,
            Err(e) => {
                let err = format!("序列化失败: {}", e);
                tm.fail_task(&tid, err.clone());
                let _ = app.emit(&event_name, TaskProgressPayload {
                    task_id: tid, status: "failed".to_string(),
                    progress: 0.0, completed: 0, total: 0, message: Some(err),
                });
                return;
            }
        };

        let file_size = content.len() as u64;
        if let Err(e) = std::fs::write(&save_path, &content) {
            let err = format!("保存文件失败: {}", e);
            tm.fail_task(&tid, err.clone());
            let _ = app.emit(&event_name, TaskProgressPayload {
                task_id: tid, status: "failed".to_string(),
                progress: 0.0, completed: 0, total: 0, message: Some(err),
            });
            return;
        }

        // 完成
        tm.complete_task(&tid, file_size);
        let _ = app.emit(&event_name, TaskProgressPayload {
            task_id: tid.clone(), status: "completed".to_string(),
            progress: 100.0, completed: 0, total: 0, message: Some("完成!".to_string()),
        });

        // 自动添加历史记录
        let record = DownloadRecord::new(
            task_name, "osm_vector".to_string(), "OSM Overpass".to_string(),
            0, "geojson".to_string(), save_path, file_size, 0, 0, DownloadStatus::Completed,
        );
        if let Ok(manager) = HistoryManager::new() {
            let _ = manager.add(record);
        }
    });

    Ok(CreateTaskResult { task_id, tile_count: 0 })
}

/// 下载 OSM 数据
#[tauri::command]
pub async fn download_osm_data(
    bounds: Bounds,
    feature_type: String,
    save_path: String,
    proxy: Option<String>,
    polygon: Option<Vec<PolygonCoord>>,
) -> Result<String, String> {
    use crate::admin::download_osm_features;
    
    // 将多边形坐标转换为 (lat, lng) 元组列表
    let poly_coords: Option<Vec<(f64, f64)>> = polygon.map(|p| {
        p.iter().map(|c| (c.lat, c.lng)).collect()
    });
    
    let geojson = download_osm_features(
        bounds.south, bounds.west, bounds.north, bounds.east,
        &feature_type,
        proxy.as_deref(),
        poly_coords.as_deref()
    ).await?;
    
    // 保存到文件
    let content = serde_json::to_string_pretty(&geojson)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&save_path, &content)
        .map_err(|e| format!("保存文件失败: {}", e))?;
    
    Ok(save_path)
}

/// 下载行政边界并保存到文件
#[tauri::command]
pub async fn download_admin_boundary_file(
    code: String,
    save_path: String,
) -> Result<String, String> {
    let geojson = admin::get_admin_boundary(&code, true).await?;
    
    let content = serde_json::to_string_pretty(&geojson)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&save_path, &content)
        .map_err(|e| format!("保存文件失败: {}", e))?;
    
    Ok(save_path)
}

/// 下载并安装更新
#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    url: String,
    version: String,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let setup_filename = format!("tif-downloader_{}_setup.exe", version);
    let setup_path = temp_dir.join(&setup_filename);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "tif-downloader")
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    
    let mut file = std::fs::File::create(&setup_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    use std::io::Write;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载失败: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("写入失败: {}", e))?;
        
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
            let _ = app.emit("update-download-progress", progress);
        }
    }
    
    drop(file);
    let _ = app.emit("update-download-progress", 100u32);
    
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // 启动安装程序
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&setup_path)
            .creation_flags(0x00000008) // DETACHED_PROCESS
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {}", e))?;
    }
    
    app.exit(0);
    Ok(())
}
