//! Esri Wayback 元数据扫描与去重模块
//!
//! 扫描所有 Wayback release 的 metadata MapServer，按拍摄日期+几何去重，
//! 生成"独立拍摄清单"，避免按 release 全量下载产生的冗余。
//!
//! 详细设计见 docs/wayback-incremental-design.md

use crate::wayback::{fetch_releases_raw, WaybackReleaseRaw};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

/// 缓存 TTL（秒）= 7 天
const CACHE_TTL_SEC: i64 = 7 * 24 * 3600;
/// 最大缓存条目数
const CACHE_MAX_ENTRIES: usize = 50;
/// 扫描并发上限
const SCAN_CONCURRENCY: usize = 8;
/// 单次 metadata 查询超时（秒）
const QUERY_TIMEOUT_SEC: u64 = 20;
/// 单 metadata 查询最大重试
const QUERY_MAX_RETRIES: u32 = 2;

// ============================================================
// 数据结构
// ============================================================

/// 一次"独立拍摄"的描述
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaybackFootprint {
    /// Unix 秒（从 SRC_DATE2 ms 截断到日）
    pub capture_date: i64,
    /// "YYYY-MM-DD"
    pub capture_date_str: String,
    /// 数据源（NICE_NAME，如 "Vivid Advanced"）
    pub source_name: String,
    /// 空间分辨率（米）
    pub resolution_m: f64,
    pub min_map_level: u32,
    pub max_map_level: u32,
    /// 最老包含此影像的 release id（waybackconfig 的 key）
    pub release_id: String,
    /// 该 release 的日期字符串（如 "2026-03-26"）
    pub release_date: String,
    /// release 顺序号（用于"最老 release"判定）
    pub release_num: u32,
    /// footprint 几何（GeoJSON Geometry，原样保存）
    pub geometry: Value,
    /// 几何去重哈希
    pub geometry_hash: String,
    /// 与用户 polygon 的覆盖比例（0..1），简化阶段用 bbox 估算
    pub coverage_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaybackScanResult {
    pub bbox: [f64; 4],
    pub zoom_min: u32,
    pub zoom_max: u32,
    pub scanned_at: String,
    pub expires_at: String,
    pub releases_scanned: u32,
    pub footprints: Vec<WaybackFootprint>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WaybackScanProgress {
    pub scan_id: String,
    pub current: u32,
    pub total: u32,
    pub elapsed_sec: u64,
    pub footprints_so_far: u32,
}

// ============================================================
// zoom -> layer 映射
// ============================================================

/// 根据 zoom 范围选取需要查询的 metadata layer 集合
pub fn select_layers(z_min: u32, z_max: u32) -> Vec<u32> {
    let mut layers = HashSet::new();
    for zoom in z_min..=z_max {
        let layer = match zoom {
            22.. => 0,
            21 => 1,
            20 => 2,
            18..=19 => 3,
            17 => 4,
            16 => 5,
            14..=15 => 6,
            13 => 7,
            11..=12 => 9,
            10 => 10,
            9 => 11,
            _ => 12,
        };
        layers.insert(layer);
    }
    let mut v: Vec<u32> = layers.into_iter().collect();
    v.sort();
    v
}

// ============================================================
// 进度跟踪
// ============================================================

#[derive(Default)]
pub struct ScanState {
    current: u32,
    total: u32,
    started_at: Option<std::time::Instant>,
    footprints_so_far: u32,
}

pub type ScanProgressMap = Arc<Mutex<HashMap<String, ScanState>>>;

pub fn new_progress_map() -> ScanProgressMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn get_progress(map: &ScanProgressMap, scan_id: &str) -> Option<WaybackScanProgress> {
    let m = map.lock().await;
    m.get(scan_id).map(|s| WaybackScanProgress {
        scan_id: scan_id.to_string(),
        current: s.current,
        total: s.total,
        elapsed_sec: s.started_at.map(|t| t.elapsed().as_secs()).unwrap_or(0),
        footprints_so_far: s.footprints_so_far,
    })
}

// ============================================================
// 缓存管理
// ============================================================

fn cache_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|p| p.join("geo-downloader").join("wayback_cache"))
        .ok_or_else(|| "无法获取缓存目录".to_string())
}

/// bbox + zoom 范围的稳定哈希前缀，用作缓存文件名
fn cache_key(bbox: &[f64; 4], z_min: u32, z_max: u32) -> String {
    let s = format!(
        "{:.6},{:.6},{:.6},{:.6}|{}|{}",
        bbox[0], bbox[1], bbox[2], bbox[3], z_min, z_max
    );
    let h = simple_hash64(s.as_bytes());
    format!("{:016x}", h)
}

fn cache_path(bbox: &[f64; 4], z_min: u32, z_max: u32) -> Result<PathBuf, String> {
    let dir = cache_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    Ok(dir.join(format!("{}.json", cache_key(bbox, z_min, z_max))))
}

fn load_cache(bbox: &[f64; 4], z_min: u32, z_max: u32) -> Option<WaybackScanResult> {
    let path = cache_path(bbox, z_min, z_max).ok()?;
    if !path.exists() {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let result: WaybackScanResult = serde_json::from_slice(&bytes).ok()?;
    let expires = chrono::DateTime::parse_from_rfc3339(&result.expires_at).ok()?;
    if chrono::Utc::now() > expires {
        return None;
    }
    Some(result)
}

/// 对外暴露的缓存读取入口
pub fn try_load_cache(bbox: &[f64; 4], z_min: u32, z_max: u32) -> Option<WaybackScanResult> {
    load_cache(bbox, z_min, z_max)
}

fn save_cache(result: &WaybackScanResult) -> Result<(), String> {
    let path = cache_path(&result.bbox, result.zoom_min, result.zoom_max)?;
    let json = serde_json::to_vec(result).map_err(|e| format!("序列化缓存失败: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("写入缓存失败: {}", e))?;
    prune_cache_lru().ok();
    Ok(())
}

/// LRU 淘汰多余缓存条目
fn prune_cache_lru() -> Result<(), String> {
    let dir = cache_dir()?;
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| format!("读取缓存目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .collect();
    if entries.len() <= CACHE_MAX_ENTRIES {
        return Ok(());
    }
    let mut with_meta: Vec<_> = entries
        .into_iter()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            let mtime = m.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();
    with_meta.sort_by_key(|(_, t)| *t); // 旧的在前
    let to_remove = with_meta.len() - CACHE_MAX_ENTRIES;
    for (path, _) in with_meta.into_iter().take(to_remove) {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

// ============================================================
// 主入口：扫描
// ============================================================

#[allow(clippy::too_many_arguments)]
pub async fn scan_metadata(
    bbox: [f64; 4],
    z_min: u32,
    z_max: u32,
    force_refresh: bool,
    proxy: Option<String>,
    progress: ScanProgressMap,
    scan_id: String,
) -> Result<WaybackScanResult, String> {
    if !force_refresh {
        if let Some(cached) = load_cache(&bbox, z_min, z_max) {
            log::info!(
                "wayback metadata: 使用缓存 ({} footprints, scanned_at {})",
                cached.footprints.len(),
                cached.scanned_at
            );
            return Ok(cached);
        }
    }

    let layers = select_layers(z_min, z_max);
    if layers.is_empty() {
        return Err("zoom 范围无效".to_string());
    }

    let releases = fetch_releases_raw(proxy.as_deref()).await?;
    let total_tasks = (releases.len() as u32) * (layers.len() as u32);

    {
        let mut m = progress.lock().await;
        m.insert(
            scan_id.clone(),
            ScanState {
                current: 0,
                total: total_tasks,
                started_at: Some(std::time::Instant::now()),
                footprints_so_far: 0,
            },
        );
    }

    let client = build_client(proxy.as_deref())?;
    let semaphore = Arc::new(Semaphore::new(SCAN_CONCURRENCY));
    let collected: Arc<Mutex<Vec<WaybackFootprint>>> = Arc::new(Mutex::new(Vec::new()));

    // 按 release_num 排序：从最新到最旧
    let mut releases_sorted: Vec<(String, WaybackReleaseRaw)> = releases.into_iter().collect();
    releases_sorted.sort_by(|a, b| b.0.cmp(&a.0));

    let release_count = releases_sorted.len();
    let mut handles = Vec::new();

    for (release_id, release) in releases_sorted {
        let release_num: u32 = release_id.parse().unwrap_or(0);
        let release_date = parse_release_date(&release.item_title);

        for &layer_id in &layers {
            let sem = Arc::clone(&semaphore);
            let client = client.clone();
            let metadata_url = release.metadata_layer_url.clone();
            let collected = Arc::clone(&collected);
            let progress = Arc::clone(&progress);
            let scan_id = scan_id.clone();
            let release_id = release_id.clone();
            let release_date = release_date.clone();

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.ok();
                let footprints = query_layer_with_retry(
                    &client,
                    &metadata_url,
                    layer_id,
                    &bbox,
                    &release_id,
                    &release_date,
                    release_num,
                )
                .await
                .unwrap_or_else(|e| {
                    log::warn!(
                        "wayback metadata: release={} layer={} 查询失败: {}",
                        release_id, layer_id, e
                    );
                    Vec::new()
                });

                let added = footprints.len() as u32;
                {
                    let mut all = collected.lock().await;
                    all.extend(footprints);
                }
                let mut m = progress.lock().await;
                if let Some(s) = m.get_mut(&scan_id) {
                    s.current += 1;
                    s.footprints_so_far += added;
                }
            });
            handles.push(handle);
        }
    }

    for h in handles {
        let _ = h.await;
    }

    let raw = Arc::try_unwrap(collected)
        .map_err(|_| "提取扫描结果失败".to_string())?
        .into_inner();

    let footprints = dedupe_footprints(raw, &bbox);

    let now = chrono::Utc::now();
    let result = WaybackScanResult {
        bbox,
        zoom_min: z_min,
        zoom_max: z_max,
        scanned_at: now.to_rfc3339(),
        expires_at: (now + chrono::Duration::seconds(CACHE_TTL_SEC)).to_rfc3339(),
        releases_scanned: release_count as u32,
        footprints,
    };

    save_cache(&result).ok();

    // 清理进度状态
    {
        let mut m = progress.lock().await;
        m.remove(&scan_id);
    }

    Ok(result)
}

// ============================================================
// HTTP 查询
// ============================================================

fn build_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(QUERY_TIMEOUT_SEC));
    if let Some(p) = proxy {
        if !p.is_empty() {
            builder = builder.proxy(
                reqwest::Proxy::all(p).map_err(|e| format!("代理配置错误: {}", e))?,
            );
        }
    }
    builder.build().map_err(|e| format!("HTTP 客户端创建失败: {}", e))
}

async fn query_layer_with_retry(
    client: &reqwest::Client,
    metadata_url: &str,
    layer_id: u32,
    bbox: &[f64; 4],
    release_id: &str,
    release_date: &str,
    release_num: u32,
) -> Result<Vec<WaybackFootprint>, String> {
    let mut last_err = String::new();
    for attempt in 0..=QUERY_MAX_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * (1 << attempt))).await;
        }
        match query_layer(
            client,
            metadata_url,
            layer_id,
            bbox,
            release_id,
            release_date,
            release_num,
        )
        .await
        {
            Ok(v) => return Ok(v),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

async fn query_layer(
    client: &reqwest::Client,
    metadata_url: &str,
    layer_id: u32,
    bbox: &[f64; 4],
    release_id: &str,
    release_date: &str,
    release_num: u32,
) -> Result<Vec<WaybackFootprint>, String> {
    let url = format!(
        "{}/{}/query?geometry={},{},{},{}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=1%3D1&outFields=SRC_DATE2,NICE_NAME,SRC_RES,MinMapLevel,MaxMapLevel&returnGeometry=true&outSR=4326&f=geojson",
        metadata_url.trim_end_matches('/'),
        layer_id,
        bbox[0], bbox[1], bbox[2], bbox[3]
    );

    let resp = client
        .get(&url)
        .header("Referer", "https://livingatlas.arcgis.com/wayback/")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let json: Value = resp.json().await.map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let features = json
        .get("features")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(features.len());
    for feat in features {
        let props = feat.get("properties").cloned().unwrap_or(Value::Null);
        let geom = feat.get("geometry").cloned().unwrap_or(Value::Null);
        if geom.is_null() {
            continue;
        }
        let src_date2 = props.get("SRC_DATE2").and_then(|v| v.as_i64()).unwrap_or(0);
        if src_date2 <= 0 {
            continue; // TerraColor 底图等无拍摄日期
        }
        let day_sec = (src_date2 / 1000 / 86400) * 86400;
        let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(day_sec, 0)
            .unwrap_or_else(chrono::Utc::now);
        let date_str = dt.format("%Y-%m-%d").to_string();
        let geom_hash = hash_geometry(&geom);
        out.push(WaybackFootprint {
            capture_date: day_sec,
            capture_date_str: date_str,
            source_name: props.get("NICE_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            resolution_m: props.get("SRC_RES").and_then(|v| v.as_f64()).unwrap_or(0.0),
            min_map_level: props.get("MinMapLevel").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            max_map_level: props.get("MaxMapLevel").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            release_id: release_id.to_string(),
            release_date: release_date.to_string(),
            release_num,
            geometry: geom,
            geometry_hash: geom_hash,
            coverage_ratio: 0.0, // 后续在 dedupe 中计算
        });
    }
    Ok(out)
}

// ============================================================
// 去重
// ============================================================

/// 同一 (capture_date_day, geometry_hash) 在多个 release 中只保留最老的 release
fn dedupe_footprints(raw: Vec<WaybackFootprint>, bbox: &[f64; 4]) -> Vec<WaybackFootprint> {
    let mut map: HashMap<(i64, String), WaybackFootprint> = HashMap::new();
    for fp in raw {
        let key = (fp.capture_date, fp.geometry_hash.clone());
        match map.get(&key) {
            Some(existing) if existing.release_num <= fp.release_num => {
                // 保留更老的（release_num 越小越老）
            }
            _ => {
                map.insert(key, fp);
            }
        }
    }
    let mut out: Vec<WaybackFootprint> = map.into_iter().map(|(_, v)| v).collect();
    // 计算覆盖率（用 footprint bbox 与用户 bbox 求交占用户 bbox 比例的简化估算）
    for fp in &mut out {
        fp.coverage_ratio = estimate_coverage(&fp.geometry, bbox);
    }
    // 按拍摄日期倒序
    out.sort_by(|a, b| b.capture_date.cmp(&a.capture_date));
    out
}

/// 简化的覆盖率估算：用 footprint 几何 bbox 与用户 bbox 的相交面积比例
fn estimate_coverage(geom: &Value, user_bbox: &[f64; 4]) -> f64 {
    let fb = geometry_bbox(geom);
    if fb[2] <= fb[0] || fb[3] <= fb[1] {
        return 0.0;
    }
    let ix = [
        fb[0].max(user_bbox[0]),
        fb[1].max(user_bbox[1]),
        fb[2].min(user_bbox[2]),
        fb[3].min(user_bbox[3]),
    ];
    if ix[2] <= ix[0] || ix[3] <= ix[1] {
        return 0.0;
    }
    let inter = (ix[2] - ix[0]) * (ix[3] - ix[1]);
    let user_area = (user_bbox[2] - user_bbox[0]) * (user_bbox[3] - user_bbox[1]);
    if user_area <= 0.0 {
        return 0.0;
    }
    (inter / user_area).clamp(0.0, 1.0)
}

/// 提取 GeoJSON Geometry 的 bbox [minx, miny, maxx, maxy]
fn geometry_bbox(geom: &Value) -> [f64; 4] {
    let mut bb = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    walk_coords(geom, &mut |x, y| {
        if x < bb[0] { bb[0] = x; }
        if y < bb[1] { bb[1] = y; }
        if x > bb[2] { bb[2] = x; }
        if y > bb[3] { bb[3] = y; }
    });
    if bb[0].is_infinite() {
        [0.0; 4]
    } else {
        bb
    }
}

fn walk_coords<F: FnMut(f64, f64)>(value: &Value, f: &mut F) {
    match value {
        Value::Array(arr) => {
            // 叶子坐标 [x, y] 或 [x, y, z]
            if arr.len() >= 2 && arr.iter().all(|v| v.is_number()) {
                let x = arr[0].as_f64().unwrap_or(0.0);
                let y = arr[1].as_f64().unwrap_or(0.0);
                f(x, y);
            } else {
                for v in arr {
                    walk_coords(v, f);
                }
            }
        }
        Value::Object(obj) => {
            if let Some(coords) = obj.get("coordinates") {
                walk_coords(coords, f);
            }
            // GeometryCollection
            if let Some(geoms) = obj.get("geometries") {
                walk_coords(geoms, f);
            }
        }
        _ => {}
    }
}

/// 几何哈希：扁平化所有坐标 → 量化（1e-4 度，约 11m）→ 64bit FNV-1a
fn hash_geometry(geom: &Value) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let mul: u64 = 0x100000001b3;
    walk_coords(geom, &mut |x, y| {
        let qx = (x * 1e4).round() as i64;
        let qy = (y * 1e4).round() as i64;
        for b in qx.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(mul);
        }
        for b in qy.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(mul);
        }
    });
    format!("{:016x}", h)
}

fn simple_hash64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    let mul: u64 = 0x100000001b3;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(mul);
    }
    h
}

fn parse_release_date(item_title: &str) -> String {
    item_title
        .strip_prefix("World Imagery (Wayback ")
        .and_then(|s| s.strip_suffix(')'))
        .unwrap_or(item_title)
        .to_string()
}
