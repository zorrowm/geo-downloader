//! 流式 GeoTIFF 写入器
//! 逐行写入瓦片行，内存仅需一行瓦片宽度，支持超大图像导出。

use crate::config::TILE_SIZE;
use crate::tile::{TileBounds, bounds_to_mercator};
use std::collections::HashMap;
use std::io::{Write, Seek, SeekFrom, BufWriter};
use std::path::{Path, PathBuf};

/// 流式合并瓦片并直接写入 GeoTIFF 文件
/// 内存占用: 仅 width × TILE_SIZE × 3 字节（一行瓦片）
pub fn merge_and_export_streaming(
    tile_files: &HashMap<(u32, u32), PathBuf>,
    x_min: u32,
    y_min: u32,
    x_max: u32,
    y_max: u32,
    bounds: &TileBounds,
    save_path: &Path,
) -> Result<u64, String> {
    let cols = x_max - x_min + 1;
    let rows = y_max - y_min + 1;
    let width = cols * TILE_SIZE;
    let height = rows * TILE_SIZE;
    let rows_per_strip = TILE_SIZE;
    let num_strips = rows; // 每行瓦片 = 一个 strip

    // 用 u64 计算字节大小，防止 u32 溢出
    let strip_byte_size_u64 = width as u64 * rows_per_strip as u64 * 3;

    let file = std::fs::File::create(save_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut w = BufWriter::new(file);

    // ===== 1. 写 BigTIFF Header =====
    // Little-endian, version=43, offset_size=8
    w.write_all(b"II").map_err(e2s)?;           // byte order
    write_u16(&mut w, 43)?;                      // BigTIFF version
    write_u16(&mut w, 8)?;                       // offset byte size
    write_u16(&mut w, 0)?;                       // reserved
    let ifd_offset_pos = stream_pos(&mut w)?;
    write_u64(&mut w, 0)?;                       // IFD offset placeholder (8 bytes)

    // ===== 2. 逐行写入 strip 数据 =====
    let strip_byte_size = strip_byte_size_u64 as usize;
    let mut strip_offsets: Vec<u64> = Vec::with_capacity(num_strips as usize);
    let mut strip_counts: Vec<u64> = Vec::with_capacity(num_strips as usize);

    for tile_y in y_min..=y_max {
        let offset = stream_pos(&mut w)?;

        // 创建一行瓦片的 strip 缓冲区（白色背景）
        let mut strip = vec![255u8; strip_byte_size];

        // 加载该行的每个瓦片
        for tile_x in x_min..=x_max {
            if let Some(file_path) = tile_files.get(&(tile_x, tile_y)) {
                if let Ok(bytes) = std::fs::read(file_path) {
                    if let Ok(img) = image::load_from_memory(&bytes) {
                        let rgb = img.to_rgb8();
                        let px = ((tile_x - x_min) * TILE_SIZE) as usize;
                        let tile_w = rgb.width().min(TILE_SIZE) as usize;
                        let tile_h = rgb.height().min(TILE_SIZE) as usize;
                        let raw = rgb.as_raw();

                        // 逐行复制瓦片像素到 strip
                        for row in 0..tile_h {
                            let src_start = row * rgb.width() as usize * 3;
                            let dst_start = row * width as usize * 3 + px * 3;
                            let len = tile_w * 3;
                            if src_start + len <= raw.len() && dst_start + len <= strip.len() {
                                strip[dst_start..dst_start + len]
                                    .copy_from_slice(&raw[src_start..src_start + len]);
                            }
                        }
                    }
                }
            }
            // img 在这里 drop，只保留当前 strip
        }

        w.write_all(&strip).map_err(e2s)?;
        strip_offsets.push(offset);
        strip_counts.push(strip_byte_size as u64);
    }
    // strip 缓冲区 drop，释放内存

    // ===== 3. 写入 IFD 所需的额外数据 =====
    // BitsPerSample [8, 8, 8]
    let bps_offset = stream_pos(&mut w)?;
    write_u16(&mut w, 8)?;
    write_u16(&mut w, 8)?;
    write_u16(&mut w, 8)?;

    // StripOffsets (LONG8 for BigTIFF)
    let strip_offsets_offset = stream_pos(&mut w)?;
    for &off in &strip_offsets {
        write_u64(&mut w, off)?;
    }

    // StripByteCounts (LONG8 for BigTIFF)
    let strip_counts_offset = stream_pos(&mut w)?;
    for &cnt in &strip_counts {
        write_u64(&mut w, cnt)?;
    }

    // XResolution, YResolution (72/1)
    let xres_offset = stream_pos(&mut w)?;
    write_u32(&mut w, 72)?;
    write_u32(&mut w, 1)?;
    let yres_offset = stream_pos(&mut w)?;
    write_u32(&mut w, 72)?;
    write_u32(&mut w, 1)?;

    // GeoTIFF: 转换为 EPSG:3857 (Web Mercator) 米坐标
    let (west_m, south_m, east_m, north_m) = bounds_to_mercator(bounds);
    let x_res = (east_m - west_m) / width as f64;
    let y_res = (north_m - south_m) / height as f64;

    // ModelPixelScale [x_res, y_res, 0]
    let pixel_scale_offset = stream_pos(&mut w)?;
    write_f64(&mut w, x_res)?;
    write_f64(&mut w, y_res)?;
    write_f64(&mut w, 0.0)?;

    // ModelTiepoint [0, 0, 0, west_m, north_m, 0]
    let tiepoint_offset = stream_pos(&mut w)?;
    write_f64(&mut w, 0.0)?;
    write_f64(&mut w, 0.0)?;
    write_f64(&mut w, 0.0)?;
    write_f64(&mut w, west_m)?;
    write_f64(&mut w, north_m)?;
    write_f64(&mut w, 0.0)?;

    // GeoKeyDirectory: EPSG:3857
    let geokeys_offset = stream_pos(&mut w)?;
    let geo_keys: [u16; 16] = [
        1, 1, 0, 3,
        1024, 0, 1, 1,       // GTModelTypeGeoKey = ModelTypeProjected
        1025, 0, 1, 1,       // GTRasterTypeGeoKey = RasterPixelIsArea
        3072, 0, 1, 3857,    // ProjectedCSTypeGeoKey = EPSG:3857
    ];
    for &k in &geo_keys {
        write_u16(&mut w, k)?;
    }

    // ===== 4. 写入 BigTIFF IFD =====
    let ifd_pos = stream_pos(&mut w)?;

    let num_entries: u64 = 15;
    write_u64(&mut w, num_entries)?;

    // BigTIFF IFD entry: tag(2) + type(2) + count(8) + value/offset(8) = 20 bytes
    write_bigtiff_entry(&mut w, 256, 4, 1, width as u64)?;                          // ImageWidth
    write_bigtiff_entry(&mut w, 257, 4, 1, height as u64)?;                         // ImageLength
    write_bigtiff_entry(&mut w, 258, 3, 3, bps_offset)?;                            // BitsPerSample
    write_bigtiff_entry(&mut w, 259, 3, 1, 1)?;                                     // Compression = None
    write_bigtiff_entry(&mut w, 262, 3, 1, 2)?;                                     // PhotometricInterpretation = RGB
    write_bigtiff_entry(&mut w, 273, 16, num_strips as u64, strip_offsets_offset)?;  // StripOffsets (LONG8)
    write_bigtiff_entry(&mut w, 277, 3, 1, 3)?;                                     // SamplesPerPixel
    write_bigtiff_entry(&mut w, 278, 4, 1, rows_per_strip as u64)?;                 // RowsPerStrip
    write_bigtiff_entry(&mut w, 279, 16, num_strips as u64, strip_counts_offset)?;  // StripByteCounts (LONG8)
    write_bigtiff_entry(&mut w, 282, 5, 1, xres_offset)?;                           // XResolution
    write_bigtiff_entry(&mut w, 283, 5, 1, yres_offset)?;                           // YResolution
    write_bigtiff_entry(&mut w, 296, 3, 1, 2)?;                                     // ResolutionUnit = Inch
    // GeoTIFF tags (EPSG:3857)
    write_bigtiff_entry(&mut w, 33550, 12, 3, pixel_scale_offset)?;                 // ModelPixelScaleTag
    write_bigtiff_entry(&mut w, 33922, 12, 6, tiepoint_offset)?;                    // ModelTiepointTag
    write_bigtiff_entry(&mut w, 34735, 3, 16, geokeys_offset)?;                     // GeoKeyDirectoryTag (16 u16 values)

    write_u64(&mut w, 0)?; // next IFD offset = 0

    // ===== 5. 回填 IFD offset =====
    w.seek(SeekFrom::Start(ifd_offset_pos)).map_err(e2s)?;
    write_u64(&mut w, ifd_pos)?;

    w.flush().map_err(e2s)?;
    drop(w);

    let file_size = std::fs::metadata(save_path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(file_size)
}

// ===== 辅助函数 =====

fn e2s(e: impl std::fmt::Display) -> String { e.to_string() }

fn stream_pos<W: Seek>(w: &mut W) -> Result<u64, String> {
    w.stream_position().map_err(e2s)
}

fn write_u16<W: Write>(w: &mut W, v: u16) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(e2s)
}

fn write_u32<W: Write>(w: &mut W, v: u32) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(e2s)
}

fn write_f64<W: Write>(w: &mut W, v: f64) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(e2s)
}

fn write_u64<W: Write>(w: &mut W, v: u64) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(e2s)
}

/// BigTIFF IFD entry: tag(2) + type(2) + count(8) + value/offset(8) = 20 bytes
/// For count=1 with small types (SHORT/LONG), the value is stored inline in the 8-byte field.
fn write_bigtiff_entry<W: Write>(w: &mut W, tag: u16, typ: u16, count: u64, value: u64) -> Result<(), String> {
    write_u16(w, tag)?;
    write_u16(w, typ)?;
    write_u64(w, count)?;
    write_u64(w, value)
}
