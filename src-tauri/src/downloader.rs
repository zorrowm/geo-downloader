//! 异步瓦片下载器模块

use crate::config::{self, TileSource, USER_AGENTS};
use crate::task::PauseControl;
use crate::tile::TileCoord;
use image::RgbImage;
use reqwest::Client;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use rand::seq::SliceRandom;
use futures::stream::{self, StreamExt};
use tokio_util::sync::CancellationToken;

/// 下载进度
#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub total: u32,
    pub completed: u32,
    pub failed: u32,
    pub status: String,
}

impl DownloadProgress {
    pub fn percent(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            (self.completed as f64 / self.total as f64 * 100.0).round()
        }
    }
}

/// 瓦片下载器
pub struct TileDownloader {
    source: TileSource,
    client: Client,
    retry_times: u32,
}

impl TileDownloader {
    /// 创建新的下载器
    pub fn new(source: TileSource, proxy: Option<&str>) -> Result<Self, String> {
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(config::TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(20)
            .pool_idle_timeout(Duration::from_secs(30))
            .tcp_keepalive(Duration::from_secs(15))
            .danger_accept_invalid_certs(true);

        // 配置代理
        if let Some(proxy_url) = proxy {
            if !proxy_url.is_empty() && !source.url.contains("tianditu.gov.cn") {
                // 天地图不使用代理
                if let Ok(proxy) = reqwest::Proxy::all(proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }

        let client = builder.build().map_err(|e| e.to_string())?;

        Ok(Self {
            source,
            client,
            retry_times: config::RETRY_TIMES,
        })
    }

    /// 生成瓦片 URL
    fn get_tile_url(&self, tile: &TileCoord) -> String {
        let mut url = self.source.url.clone();

        // 替换子域名
        if !self.source.subdomains.is_empty() {
            let subdomain = self
                .source
                .subdomains
                .choose(&mut rand::thread_rng())
                .unwrap();
            url = url.replace("{s}", subdomain);
        }

        // 替换坐标
        url = url.replace("{x}", &tile.x.to_string());
        url = url.replace("{y}", &tile.y.to_string());
        url = url.replace("{z}", &tile.z.to_string());

        url
    }

    /// 获取请求头
    fn get_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();

        // 随机 User-Agent
        let ua = USER_AGENTS.choose(&mut rand::thread_rng()).unwrap();
        headers.insert(
            reqwest::header::USER_AGENT,
            ua.parse().unwrap(),
        );

        headers.insert(
            reqwest::header::ACCEPT,
            "image/webp,image/apng,image/*,*/*;q=0.8".parse().unwrap(),
        );

        // 设置 Referer
        let referer = if self.source.url.contains("tianditu") {
            "https://map.tianditu.gov.cn/"
        } else {
            "https://www.google.com/maps"
        };
        headers.insert(reqwest::header::REFERER, referer.parse().unwrap());

        headers
    }

    /// 下载单个瓦片（带重试）
    async fn download_one_tile(
        client: &Client,
        url: &str,
        headers: &reqwest::header::HeaderMap,
        file_path: &Path,
        retry_times: u32,
        retrying_count: Option<&AtomicU32>,
    ) -> Result<(), String> {
        let mut last_error = String::new();

        for attempt in 0..=retry_times {
            let req_fut = async {
                match client.get(url).headers(headers.clone()).send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        if status.is_success() {
                            match resp.bytes().await {
                                Ok(bytes) => match tokio::fs::write(file_path, &bytes).await {
                                    Ok(_) => Ok(()),
                                    Err(e) => Err((format!("写入失败: {}", e), false)),
                                },
                                Err(e) => Err((format!("读取失败: {}", e), false)),
                            }
                        } else if status.as_u16() == 429 || status.as_u16() == 503 {
                            Err((format!("HTTP {}", status), true))
                        } else {
                            Err((format!("HTTP {}", status), false))
                        }
                    }
                    Err(e) => Err((e.to_string(), false)),
                }
            };

            match tokio::time::timeout(Duration::from_secs(8), req_fut).await {
                Ok(Ok(())) => return Ok(()),
                Ok(Err((e, rate_limited))) => {
                    last_error = e;
                    if attempt < retry_times {
                        if let Some(counter) = retrying_count {
                            counter.fetch_add(1, Ordering::Relaxed);
                        }
                        let delay = if rate_limited { 2000 * (attempt as u64 + 1) } else { 300 * (attempt as u64 + 1) };
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        if let Some(counter) = retrying_count {
                            counter.fetch_sub(1, Ordering::Relaxed);
                        }
                    }
                }
                Err(_) => {
                    last_error = "请求超时".to_string();
                    if attempt < retry_times {
                        if let Some(counter) = retrying_count {
                            counter.fetch_add(1, Ordering::Relaxed);
                        }
                        tokio::time::sleep(Duration::from_millis(500 * (attempt as u64 + 1))).await;
                        if let Some(counter) = retrying_count {
                            counter.fetch_sub(1, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
        Err(last_error)
    }

    /// 批量下载瓦片到临时目录
    pub async fn download_tiles<F>(
        &self,
        tiles: Vec<TileCoord>,
        concurrency: usize,
        temp_dir: &Path,
        cancel_token: Option<&CancellationToken>,
        pause_control: Option<&PauseControl>,
        mut progress_callback: F,
    ) -> Result<HashMap<(u32, u32), PathBuf>, String>
    where
        F: FnMut(DownloadProgress),
    {
        let concurrency = concurrency.clamp(10, 100);
        let total = tiles.len() as u32;
        let mut completed = 0u32;
        let mut failed = 0u32;
        let mut tile_files: HashMap<(u32, u32), PathBuf> = HashMap::with_capacity(tiles.len());
        let temp_dir = temp_dir.to_path_buf();

        // 打乱瓦片顺序，避免限速时失败集中在同一列
        let mut tiles = tiles;
        tiles.shuffle(&mut rand::thread_rng());

        // 检查已存在的瓦片文件（断点续传）
        let mut need_download: Vec<TileCoord> = Vec::new();
        for tile in &tiles {
            let file_path = temp_dir.join(format!("{}_{}.bin", tile.x, tile.y));
            if file_path.exists() && std::fs::metadata(&file_path).map_or(false, |m| m.len() > 0) {
                tile_files.insert((tile.x, tile.y), file_path);
                completed += 1;
            } else {
                need_download.push(tile.clone());
            }
        }
        let skipped = completed;

        // 报告初始进度
        progress_callback(DownloadProgress {
            total, completed, failed, status: if skipped > 0 {
                format!("已跳过 {} 个已下载瓦片", skipped)
            } else {
                "downloading".to_string()
            },
        });

        // ===== 第一轮：主下载 =====
        let mut failed_tiles: Vec<TileCoord> = Vec::new();
        let retrying_counter = std::sync::Arc::new(AtomicU32::new(0));

        let all_futures = need_download.into_iter().map(|tile| {
            let url = self.get_tile_url(&tile);
            let headers = self.get_headers();
            let client = self.client.clone();
            let retry_times = self.retry_times;
            let td = temp_dir.clone();
            let rc = retrying_counter.clone();

            async move {
                let file_path = td.join(format!("{}_{}.bin", tile.x, tile.y));
                let result = Self::download_one_tile(&client, &url, &headers, &file_path, retry_times, Some(&rc)).await;
                (tile, result.map(|_| file_path))
            }
        });

        let mut tile_stream = stream::iter(all_futures).buffer_unordered(concurrency);
        let mut stall_timer = tokio::time::interval(Duration::from_secs(3));
        stall_timer.tick().await; // 跳过第一个立即触发的 tick

        loop {
            // 暂停检查：如果已暂停，等待恢复后再继续拉取新瓦片
            if let Some(pc) = pause_control {
                if pc.is_paused() {
                    progress_callback(DownloadProgress {
                        total, completed, failed, status: "paused".to_string(),
                    });
                    pc.wait_if_paused().await;
                    progress_callback(DownloadProgress {
                        total, completed, failed, status: "downloading".to_string(),
                    });
                }
            }
            tokio::select! {
                result = tile_stream.next() => {
                    match result {
                        Some((tile, Ok(path))) => {
                            tile_files.insert((tile.x, tile.y), path);
                            completed += 1;
                        }
                        Some((tile, Err(_))) => {
                            failed_tiles.push(tile);
                            failed += 1;
                        }
                        None => break, // 所有瓦片处理完毕
                    }
                    if let Some(token) = cancel_token {
                        if token.is_cancelled() { return Err("任务已取消".to_string()); }
                    }
                    if (completed + failed) % 50 == 0 || (completed + failed) == total {
                        let retrying = retrying_counter.load(Ordering::Relaxed);
                        let status = if retrying > 0 {
                            format!("下载中，{} 个瓦片正在重试", retrying)
                        } else {
                            "downloading".to_string()
                        };
                        progress_callback(DownloadProgress {
                            total, completed, failed, status,
                        });
                    }
                }
                _ = stall_timer.tick() => {
                    // 定时报告进度，即使没有瓦片完成
                    if let Some(token) = cancel_token {
                        if token.is_cancelled() { return Err("任务已取消".to_string()); }
                    }
                    let retrying = retrying_counter.load(Ordering::Relaxed);
                    if retrying > 0 {
                        progress_callback(DownloadProgress {
                            total, completed, failed,
                            status: format!("下载中，{} 个瓦片正在重试", retrying),
                        });
                    }
                }
            }
        }

        // ===== 重试队列：最多 3 轮，每轮降低并发 + 增加间隔 =====
        const MAX_RETRY_ROUNDS: usize = 3;
        let retry_delays_secs: [u64; 3] = [5, 15, 30];
        let retry_concurrencies: [usize; 3] = [
            (concurrency / 2).max(5),
            (concurrency / 4).max(3),
            (concurrency / 6).max(2),
        ];

        for round in 0..MAX_RETRY_ROUNDS {
            if failed_tiles.is_empty() { break; }
            if let Some(token) = cancel_token {
                if token.is_cancelled() { return Err("任务已取消".to_string()); }
            }
            if let Some(pc) = pause_control {
                pc.wait_if_paused().await;
            }

            let retry_count = failed_tiles.len();
            let wait_secs = retry_delays_secs[round];
            progress_callback(DownloadProgress {
                total, completed, failed,
                status: format!("重试第{}轮: {} 个失败瓦片，等待 {}s 后重试...", round + 1, retry_count, wait_secs),
            });

            // 等待一段时间再重试，让服务器限速恢复
            tokio::time::sleep(Duration::from_secs(wait_secs)).await;

            progress_callback(DownloadProgress {
                total, completed, failed,
                status: format!("重试第{}轮: 开始重试 {} 个瓦片，并发 {}", round + 1, retry_count, retry_concurrencies[round]),
            });

            let mut still_failed: Vec<TileCoord> = Vec::new();
            let rc = retry_concurrencies[round];

            failed_tiles.shuffle(&mut rand::thread_rng());

            let retry_futures = failed_tiles.into_iter().map(|tile| {
                let url = self.get_tile_url(&tile);
                let headers = self.get_headers();
                let client = self.client.clone();
                let td = temp_dir.clone();

                async move {
                    let file_path = td.join(format!("{}_{}.bin", tile.x, tile.y));
                    // 重试轮只给 1 次重试机会
                    let result = Self::download_one_tile(&client, &url, &headers, &file_path, 1, None).await;
                    (tile, result.map(|_| file_path))
                }
            });

            let mut retry_stream = stream::iter(retry_futures).buffer_unordered(rc);

            while let Some((tile, result)) = retry_stream.next().await {
                if let Some(token) = cancel_token {
                    if token.is_cancelled() { return Err("任务已取消".to_string()); }
                }
                match result {
                    Ok(path) => {
                        tile_files.insert((tile.x, tile.y), path);
                        completed += 1;
                        failed -= 1;
                    }
                    Err(_) => {
                        still_failed.push(tile);
                    }
                }
                progress_callback(DownloadProgress {
                    total, completed, failed,
                    status: format!("重试第{}轮...", round + 1),
                });
            }

            failed_tiles = still_failed;
        }

        // 报告完成
        let status = if failed == 0 { "completed" } else { "completed_with_errors" };
        progress_callback(DownloadProgress {
            total, completed, failed, status: status.to_string(),
        });

        if tile_files.is_empty() {
            return Err("没有成功下载任何瓦片".to_string());
        }

        Ok(tile_files)
    }
}

/// 创建空白瓦片 (白色)
pub fn create_blank_tile() -> RgbImage {
    RgbImage::from_pixel(
        config::TILE_SIZE,
        config::TILE_SIZE,
        image::Rgb([255, 255, 255]),
    )
}
