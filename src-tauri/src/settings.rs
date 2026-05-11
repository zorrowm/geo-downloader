//! 应用设置模块

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 自定义瓦片图源
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTileSource {
    /// 图源 ID（自动生成，前缀 custom_）
    pub id: String,
    /// 显示名称
    pub name: String,
    /// URL 模板，支持 {x}, {y}, {z}, {s} 占位符
    pub url: String,
    /// 子域名，逗号分隔
    #[serde(default)]
    pub subdomains: String,
    /// 最大缩放级别
    #[serde(default = "default_max_zoom")]
    pub max_zoom: u8,
}

fn default_max_zoom() -> u8 { 18 }

/// 应用设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 天地图 Token
    #[serde(default)]
    pub tianditu_token: Option<String>,
    /// 是否启用代理
    #[serde(default = "default_proxy_enabled")]
    pub proxy_enabled: bool,
    /// 代理地址
    #[serde(default = "default_proxy_url")]
    pub proxy_url: String,
    /// 默认并发数
    #[serde(default = "default_concurrency")]
    pub default_concurrency: u32,
    /// 默认缩放级别
    #[serde(default = "default_zoom")]
    pub default_zoom: u8,
    /// 默认输出格式
    #[serde(default = "default_format")]
    pub default_format: String,
    /// 默认图源
    #[serde(default = "default_source")]
    pub default_source: String,
    /// 自定义图源列表
    #[serde(default)]
    pub custom_sources: Vec<CustomTileSource>,
    /// 内置图源覆盖配置（用户修改后的内置图源）
    #[serde(default)]
    pub source_overrides: Vec<CustomTileSource>,
    /// Cesium Ion Access Token
    #[serde(default)]
    pub cesium_ion_token: Option<String>,
    /// 调试模式：保留临时瓦片目录
    #[serde(default)]
    pub debug_mode: bool,
    /// 内存预算 (MB)，控制单次导出任务的最大内存占用
    ///
    /// 范围 512 - 16384，默认 2048。超出预算的导出请求会被拒绝并给出建议。
    #[serde(default = "default_memory_budget_mb")]
    pub memory_budget_mb: u64,
    /// 允许接受无效的 HTTPS 证书（⚠️ 安全风险）
    ///
    /// 默认 `false` —— 严格验证 TLS 证书。仅在用户明确知晓风险（如企业
    /// 内网自签证书、测试私有图源）时手动开启。开启后 HTTPS 连接可被
    /// 中间人攻击嗅探或篡改，**不得默认启用**。
    #[serde(default)]
    pub allow_invalid_certs: bool,
    /// 是否启用「浏览即缓存」瓦片缓存
    #[serde(default = "default_tile_cache_enabled")]
    pub tile_cache_enabled: bool,
    /// 瓦片缓存容量上限（MB），0 表示不限制
    #[serde(default = "default_tile_cache_max_size_mb")]
    pub tile_cache_max_size_mb: u64,
    /// 瓦片缓存目录（None = 使用默认 data_local_dir）
    #[serde(default)]
    pub tile_cache_dir: Option<String>,
    /// 自动导出的最低成功率阈值 (0.0 - 1.0)
    ///
    /// 任务下载结束后，成功率 ≥ 此值才自动走合并 / 导出流水线。
    /// - `0.0`（默认）：只要有 1 张成功瓦片就尝试导出（即"睡醒就有 TIF"幸福路径）
    /// - `1.0`：必须全部成功才导出，否则进入待决策 Paused 状态
    /// - 中间值：例如 `0.95` 表示允许 5% 缺洞自动导出，超出则等用户决策
    #[serde(default = "default_min_export_success_ratio")]
    pub min_export_success_ratio: f32,
}

fn default_proxy_enabled() -> bool { false }
fn default_proxy_url() -> String { "http://127.0.0.1:10808".to_string() }
fn default_concurrency() -> u32 { 30 }
fn default_zoom() -> u8 { 15 }
fn default_format() -> String { "geotiff".to_string() }
fn default_source() -> String { "osm".to_string() }
fn default_memory_budget_mb() -> u64 { 2048 }
fn default_tile_cache_enabled() -> bool { true }
fn default_tile_cache_max_size_mb() -> u64 { 5120 }
fn default_min_export_success_ratio() -> f32 { 0.0 }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tianditu_token: None,
            proxy_enabled: default_proxy_enabled(),
            proxy_url: default_proxy_url(),
            default_concurrency: default_concurrency(),
            default_zoom: default_zoom(),
            default_format: default_format(),
            default_source: default_source(),
            custom_sources: vec![],
            source_overrides: vec![],
            cesium_ion_token: None,
            memory_budget_mb: default_memory_budget_mb(),
            debug_mode: false,
            allow_invalid_certs: false,
            tile_cache_enabled: default_tile_cache_enabled(),
            tile_cache_max_size_mb: default_tile_cache_max_size_mb(),
            tile_cache_dir: None,
            min_export_success_ratio: default_min_export_success_ratio(),
        }
    }
}

/// 设置管理器
pub struct SettingsManager {
    file_path: PathBuf,
}

impl SettingsManager {
    /// 创建管理器实例
    pub fn new() -> Result<Self, String> {
        let data_dir = get_data_dir()?;
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("无法创建数据目录: {}", e))?;
        
        let file_path = data_dir.join("settings.json");
        Ok(Self { file_path })
    }

    /// 获取设置
    pub fn get(&self) -> Result<AppSettings, String> {
        if !self.file_path.exists() {
            return Ok(AppSettings::default());
        }

        let content = fs::read_to_string(&self.file_path)
            .map_err(|e| format!("读取设置失败: {}", e))?;
        
        if content.trim().is_empty() {
            return Ok(AppSettings::default());
        }

        serde_json::from_str(&content)
            .map_err(|e| format!("解析设置失败: {}", e))
    }

    /// 保存设置
    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        let content = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("序列化失败: {}", e))?;
        
        fs::write(&self.file_path, content)
            .map_err(|e| format!("保存设置失败: {}", e))
    }
}

/// 获取数据目录
fn get_data_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|p| p.join("geo-downloader"))
        .ok_or_else(|| "无法获取数据目录".to_string())
}
