import { invokeCommand } from '@/lib/tauri'
import type { DownloadHistoryRecord, OutputFormat } from '@/types/api'

export function getDownloadHistory() {
  return invokeCommand<DownloadHistoryRecord[]>('get_download_history')
}

export function addDownloadRecord(
  name: string,
  source: string,
  sourceName: string,
  zoom: number,
  format: OutputFormat,
  filePath: string,
  fileSize: number,
  tileCount: number,
  failedCount: number,
  success: boolean,
) {
  return invokeCommand<unknown>('add_download_record', {
    name,
    source,
    sourceName,
    zoom,
    format,
    filePath,
    fileSize,
    tileCount,
    failedCount,
    success,
  })
}

export function deleteDownloadRecord(id: string | number) {
  return invokeCommand<void>('delete_download_record', { id })
}

export function clearDownloadHistory() {
  return invokeCommand<void>('clear_download_history')
}

export function buildPyramidForFile(recordId: string | number, filePath: string) {
  return invokeCommand<void>('build_pyramid_for_file', { recordId, filePath })
}

export function openFileLocation(filePath: string) {
  return invokeCommand<void>('open_file_location', { filePath })
}

export function openFile(filePath: string) {
  return invokeCommand<void>('open_file', { filePath })
}
