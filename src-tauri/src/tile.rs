//! 瓦片坐标计算模块
//! Web Mercator (EPSG:3857) 瓦片坐标系统

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// 瓦片坐标
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TileCoord {
    pub x: u32,
    pub y: u32,
    pub z: u8,
}

/// 地理边界
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Bounds {
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
}

/// 瓦片边界
#[derive(Debug, Clone, Copy)]
pub struct TileBounds {
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
}

/// 经纬度转瓦片坐标 (浮点数)
pub fn latlng_to_tile_float(lat: f64, lng: f64, zoom: u8) -> (f64, f64) {
    // 限制纬度范围
    let lat = lat.max(-85.05112878).min(85.05112878);
    let n = 2.0_f64.powi(zoom as i32);

    let x = (lng + 180.0) / 360.0 * n;
    let lat_rad = lat.to_radians();
    let y = (1.0 - (lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / PI) / 2.0 * n;

    (x, y)
}

/// 经纬度转瓦片坐标 (整数)
pub fn latlng_to_tile(lat: f64, lng: f64, zoom: u8) -> (u32, u32) {
    let (x, y) = latlng_to_tile_float(lat, lng, zoom);
    let n = 2.0_f64.powi(zoom as i32) as u32;

    let x_int = (x as u32).min(n.saturating_sub(1));
    let y_int = (y as u32).min(n.saturating_sub(1));

    (x_int, y_int)
}

/// 瓦片坐标转地理边界
pub fn tile_to_latlng(x: u32, y: u32, zoom: u8) -> TileBounds {
    let n = 2.0_f64.powi(zoom as i32);

    // 左上角 (西北)
    let west = x as f64 / n * 360.0 - 180.0;
    let north = (PI * (1.0 - 2.0 * y as f64 / n)).sinh().atan().to_degrees();

    // 右下角 (东南)
    let east = (x + 1) as f64 / n * 360.0 - 180.0;
    let south = (PI * (1.0 - 2.0 * (y + 1) as f64 / n))
        .sinh()
        .atan()
        .to_degrees();

    TileBounds {
        north,
        south,
        east,
        west,
    }
}

/// 获取边界框内的所有瓦片
pub fn get_tiles_in_bounds(bounds: &Bounds, zoom: u8) -> Vec<TileCoord> {
    let (x_min, y_min) = latlng_to_tile(bounds.north, bounds.west, zoom);
    let (x_max, y_max) = latlng_to_tile(bounds.south, bounds.east, zoom);

    let mut tiles = Vec::new();
    for x in x_min..=x_max {
        for y in y_min..=y_max {
            tiles.push(TileCoord { x, y, z: zoom });
        }
    }
    tiles
}

/// 获取瓦片矩阵尺寸
pub fn get_tile_matrix_size(bounds: &Bounds, zoom: u8) -> (u32, u32, u32, u32, u32, u32) {
    let (x_min, y_min) = latlng_to_tile(bounds.north, bounds.west, zoom);
    let (x_max, y_max) = latlng_to_tile(bounds.south, bounds.east, zoom);

    let cols = x_max - x_min + 1;
    let rows = y_max - y_min + 1;

    (x_min, y_min, x_max, y_max, cols, rows)
}

/// 获取合并后的地理边界
pub fn get_merged_bounds(x_min: u32, y_min: u32, x_max: u32, y_max: u32, zoom: u8) -> TileBounds {
    let nw = tile_to_latlng(x_min, y_min, zoom);
    let se = tile_to_latlng(x_max, y_max, zoom);

    TileBounds {
        north: nw.north,
        south: se.south,
        east: se.east,
        west: nw.west,
    }
}

/// 估算瓦片数量
pub fn estimate_tile_count(bounds: &Bounds, zoom: u8) -> u32 {
    let (x_min, y_min) = latlng_to_tile(bounds.north, bounds.west, zoom);
    let (x_max, y_max) = latlng_to_tile(bounds.south, bounds.east, zoom);

    let cols = x_max.saturating_sub(x_min) + 1;
    let rows = y_max.saturating_sub(y_min) + 1;

    cols * rows
}

/// 计算给定纬度和缩放级别的每像素米数
pub fn meters_per_pixel(lat: f64, zoom: u8) -> f64 {
    const EARTH_CIRCUMFERENCE: f64 = 40075016.686;
    EARTH_CIRCUMFERENCE * lat.to_radians().cos() / (256.0 * 2.0_f64.powi(zoom as i32))
}

/// WGS-84 经纬度 → Web Mercator (EPSG:3857) 米坐标
pub fn latlng_to_mercator(lat: f64, lng: f64) -> (f64, f64) {
    const R: f64 = 6_378_137.0; // WGS-84 赤道半径
    let x = R * lng.to_radians();
    let y = R * (PI / 4.0 + lat.to_radians() / 2.0).tan().ln();
    (x, y)
}

/// TileBounds 转 Web Mercator 米坐标
pub fn bounds_to_mercator(b: &TileBounds) -> (f64, f64, f64, f64) {
    let (west_m, north_m) = latlng_to_mercator(b.north, b.west);
    let (east_m, south_m) = latlng_to_mercator(b.south, b.east);
    (west_m, south_m, east_m, north_m)
}

/// 获取最佳缩放级别 (不超过最大瓦片数)
pub fn get_optimal_zoom(bounds: &Bounds, max_tiles: u32) -> u8 {
    for zoom in (1..=20).rev() {
        let count = estimate_tile_count(bounds, zoom);
        if count <= max_tiles {
            return zoom;
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_latlng_to_tile() {
        let (x, y) = latlng_to_tile(39.9042, 116.4074, 15);
        assert!(x > 0);
        assert!(y > 0);
    }

    #[test]
    fn test_estimate_tile_count() {
        let bounds = Bounds {
            north: 39.95,
            south: 39.85,
            east: 116.45,
            west: 116.35,
        };
        let count = estimate_tile_count(&bounds, 15);
        assert!(count > 0);
    }

    /// 验证 Mercator 坐标的圆整一致性：
    /// 直接从瓦片网格计算 vs 经过 lat/lng 转换
    #[test]
    fn test_mercator_roundtrip_accuracy() {
        const C: f64 = 2.0 * PI * 6_378_137.0; // Web Mercator 周长

        for zoom in [1u8, 5, 10, 15] {
            let n = 2.0_f64.powi(zoom as i32);
            // 取中国区域的瓦片
            let (x_min, y_min) = latlng_to_tile(40.0, 116.0, zoom);
            let (x_max, y_max) = latlng_to_tile(39.0, 117.0, zoom);

            // 方法 A: 直接从瓦片网格计算 Mercator 坐标
            let west_direct = (x_min as f64 / n - 0.5) * C;
            let east_direct = ((x_max + 1) as f64 / n - 0.5) * C;
            let north_direct = (0.5 - y_min as f64 / n) * C;
            let south_direct = (0.5 - (y_max + 1) as f64 / n) * C;

            // 方法 B: 经过 tile_to_latlng -> bounds_to_mercator
            let merged = get_merged_bounds(x_min, y_min, x_max, y_max, zoom);
            let (west_rt, south_rt, east_rt, north_rt) = bounds_to_mercator(&merged);

            let eps = 0.01; // 0.01 米精度
            assert!((west_direct - west_rt).abs() < eps, "z{zoom} west: {west_direct} vs {west_rt}");
            assert!((east_direct - east_rt).abs() < eps, "z{zoom} east: {east_direct} vs {east_rt}");
            assert!((north_direct - north_rt).abs() < eps, "z{zoom} north: {north_direct} vs {north_rt}");
            assert!((south_direct - south_rt).abs() < eps, "z{zoom} south: {south_direct} vs {south_rt}");
        }
    }

    /// 验证 Web Mercator 像素尺寸在 X/Y 方向应该相等
    #[test]
    fn test_mercator_pixel_scale_uniform() {
        for zoom in [1u8, 5, 10, 15, 18] {
            let n = 2.0_f64.powi(zoom as i32);
            let (x_min, y_min) = latlng_to_tile(55.0, 73.0, zoom);
            let (x_max, y_max) = latlng_to_tile(3.0, 135.0, zoom);
            let cols = x_max - x_min + 1;
            let rows = y_max - y_min + 1;
            let width = (cols * 256) as f64;
            let height = (rows * 256) as f64;

            let merged = get_merged_bounds(x_min, y_min, x_max, y_max, zoom);
            let (west_m, south_m, east_m, north_m) = bounds_to_mercator(&merged);
            let x_res = (east_m - west_m) / width;
            let y_res = (north_m - south_m) / height;

            // Web Mercator 的像素尺寸在 x 和 y 方向应该完全一致
            assert!(
                (x_res - y_res).abs() < 0.001,
                "z{zoom}: x_res={x_res}, y_res={y_res}, diff={}",
                (x_res - y_res).abs()
            );
        }
    }
}
