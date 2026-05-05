//! 单个 mbtiles 文件的读写封装。
//!
//! 仅在 `pool.rs` 中通过 Mutex 同步访问，store 层无需自己加锁。

use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};

use super::{xyz_to_tms_row, SourceInfo, SourceStats, StoredTile, TileCoord};

pub struct TileStore {
    conn: Connection,
    source_key: String,
}

impl TileStore {
    /// 打开（必要时创建）一个 mbtiles 文件。
    pub fn open(path: &Path, source_key: &str) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建缓存目录失败 {}: {}", parent.display(), e))?;
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("打开 mbtiles 失败 {}: {}", path.display(), e))?;

        // 性能调优
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "synchronous", "NORMAL").ok();
        conn.pragma_update(None, "temp_store", "MEMORY").ok();
        conn.pragma_update(None, "cache_size", -8000i64).ok();
        conn.pragma_update(None, "mmap_size", 268_435_456i64).ok();

        // schema
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE IF NOT EXISTS tiles (
                 zoom_level  INTEGER NOT NULL,
                 tile_column INTEGER NOT NULL,
                 tile_row    INTEGER NOT NULL,
                 tile_data   BLOB NOT NULL,
                 PRIMARY KEY (zoom_level, tile_column, tile_row)
             );",
        )
        .map_err(|e| format!("初始化 mbtiles schema 失败: {}", e))?;

        Ok(Self {
            conn,
            source_key: source_key.to_string(),
        })
    }

    /// 写入或更新基础元数据。仅在缺失时填入，不覆盖用户已有值（除了 last_used_at）。
    pub fn ensure_metadata(&mut self, info: &SourceInfo) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let pairs: Vec<(&str, String)> = vec![
            ("name", if info.display_name.is_empty() { self.source_key.clone() } else { info.display_name.clone() }),
            ("format", if info.format.is_empty() { "png".into() } else { info.format.clone() }),
            ("type", "baselayer".into()),
            ("version", "1".into()),
            ("description", "Cached by GeoDownloader".into()),
            ("gd_source_key", self.source_key.clone()),
            ("gd_url_template", info.url_template.clone()),
            ("gd_capture_at", info.capture_at.clone().unwrap_or_default()),
            ("gd_created_at", now.clone()),
        ];
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        for (k, v) in &pairs {
            tx.execute(
                "INSERT OR IGNORE INTO metadata (name, value) VALUES (?1, ?2)",
                params![k, v],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(b) = info.bounds {
            tx.execute(
                "INSERT OR IGNORE INTO metadata (name, value) VALUES ('bounds', ?1)",
                params![format!("{},{},{},{}", b[0], b[1], b[2], b[3])],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(z) = info.min_zoom {
            tx.execute(
                "INSERT OR IGNORE INTO metadata (name, value) VALUES ('minzoom', ?1)",
                params![z.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(z) = info.max_zoom {
            tx.execute(
                "INSERT OR IGNORE INTO metadata (name, value) VALUES ('maxzoom', ?1)",
                params![z.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(a) = &info.attribution {
            tx.execute(
                "INSERT OR IGNORE INTO metadata (name, value) VALUES ('attribution', ?1)",
                params![a],
            )
            .map_err(|e| e.to_string())?;
        }
        // last_used_at 总是覆盖
        tx.execute(
            "INSERT INTO metadata (name, value) VALUES ('gd_last_used_at', ?1)
             ON CONFLICT(name) DO UPDATE SET value=excluded.value",
            params![now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 查询单个瓦片。
    pub fn get(&self, c: TileCoord) -> Result<Option<StoredTile>, String> {
        let tms_y = xyz_to_tms_row(c.z, c.y);
        let mut stmt = self
            .conn
            .prepare_cached(
                "SELECT tile_data FROM tiles WHERE zoom_level=?1 AND tile_column=?2 AND tile_row=?3",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(params![c.z as i64, c.x as i64, tms_y as i64])
            .map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let bytes: Vec<u8> = row.get(0).map_err(|e| e.to_string())?;
            let content_type = self.cached_format_to_mime();
            return Ok(Some(StoredTile { bytes, content_type }));
        }
        Ok(None)
    }

    /// 单瓦片写入（失败不抛异常给调用方流程，仅返回 Err 让上层 log）。
    pub fn put(&mut self, c: TileCoord, tile: &StoredTile) -> Result<(), String> {
        let tms_y = xyz_to_tms_row(c.z, c.y);
        self.conn
            .execute(
                "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?1,?2,?3,?4)",
                params![c.z as i64, c.x as i64, tms_y as i64, tile.bytes],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 批量写入（事务）。
    pub fn put_batch(&mut self, batch: &[(TileCoord, StoredTile)]) -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?1,?2,?3,?4)",
                )
                .map_err(|e| e.to_string())?;
            for (c, tile) in batch {
                let tms_y = xyz_to_tms_row(c.z, c.y);
                stmt.execute(params![c.z as i64, c.x as i64, tms_y as i64, tile.bytes])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 更新 last_used_at（不要在每次 get 都调用，性能敏感）。
    pub fn touch(&mut self) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT INTO metadata (name, value) VALUES ('gd_last_used_at', ?1)
                 ON CONFLICT(name) DO UPDATE SET value=excluded.value",
                params![now],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 统计信息。
    pub fn stats(&self, file_size: u64) -> Result<SourceStats, String> {
        let tile_count: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tiles", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let read_meta = |k: &str| -> Option<String> {
            self.conn
                .query_row(
                    "SELECT value FROM metadata WHERE name=?1",
                    params![k],
                    |r| r.get::<_, String>(0),
                )
                .ok()
        };
        let display_name = read_meta("name").unwrap_or_else(|| self.source_key.clone());
        let format = read_meta("format").unwrap_or_else(|| "png".to_string());
        let min_zoom = read_meta("minzoom").and_then(|s| s.parse::<u8>().ok());
        let max_zoom = read_meta("maxzoom").and_then(|s| s.parse::<u8>().ok());
        let created_at = read_meta("gd_created_at");
        let last_used_at = read_meta("gd_last_used_at");
        Ok(SourceStats {
            source: self.source_key.clone(),
            display_name,
            format,
            tile_count,
            size_bytes: file_size,
            min_zoom,
            max_zoom,
            created_at,
            last_used_at,
        })
    }

    fn cached_format_to_mime(&self) -> String {
        let fmt = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE name='format'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "png".to_string());
        match fmt.as_str() {
            "jpg" | "jpeg" => "image/jpeg".into(),
            "webp" => "image/webp".into(),
            "pbf" => "application/x-protobuf".into(),
            _ => "image/png".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_and_read_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.mbtiles");
        let mut store = TileStore::open(&path, "test").unwrap();
        let info = SourceInfo {
            display_name: "Test".into(),
            url_template: "https://x/{z}/{x}/{y}.png".into(),
            format: "png".into(),
            ..Default::default()
        };
        store.ensure_metadata(&info).unwrap();

        let coord = TileCoord { z: 5, x: 10, y: 12 };
        assert!(store.get(coord).unwrap().is_none());
        let tile = StoredTile {
            bytes: vec![1, 2, 3, 4, 5],
            content_type: "image/png".into(),
        };
        store.put(coord, &tile).unwrap();
        let got = store.get(coord).unwrap().unwrap();
        assert_eq!(got.bytes, tile.bytes);
        assert_eq!(got.content_type, "image/png");

        // 行号转换：相邻 y 应能正确区分
        let coord2 = TileCoord { z: 5, x: 10, y: 13 };
        assert!(store.get(coord2).unwrap().is_none());
    }

    #[test]
    fn batch_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("batch.mbtiles");
        let mut store = TileStore::open(&path, "batch").unwrap();
        store.ensure_metadata(&SourceInfo::default()).unwrap();
        let batch: Vec<_> = (0..10)
            .map(|i| {
                (
                    TileCoord { z: 3, x: i, y: i },
                    StoredTile {
                        bytes: vec![i as u8; 4],
                        content_type: "image/png".into(),
                    },
                )
            })
            .collect();
        store.put_batch(&batch).unwrap();
        for (c, t) in &batch {
            let got = store.get(*c).unwrap().unwrap();
            assert_eq!(got.bytes, t.bytes);
        }
        let stats = store.stats(0).unwrap();
        assert_eq!(stats.tile_count, 10);
    }
}
