//! 文件系统工具：原子写入等。

use std::fs;
use std::io::Write;
use std::path::Path;

/// 原子写入：先写同目录临时文件，fsync 后 rename 覆盖目标，
/// 避免进程崩溃/断电时产生半截（截断）文件破坏 JSON 配置/状态。
///
/// 同目录 rename 在主流文件系统上是原子操作（Windows 上 Rust 使用
/// MoveFileEx 覆盖现有文件）。临时文件名带进程 id，避免不同进程撞名。
pub fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().filter(|p| !p.as_os_str().is_empty());
    let dir = dir.unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "out".to_string());
    let tmp_path = dir.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    {
        let mut f = fs::File::create(&tmp_path)?;
        f.write_all(content)?;
        f.sync_all()?;
    }

    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            // rename 失败时清理临时文件，避免遗留垃圾
            let _ = fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}
