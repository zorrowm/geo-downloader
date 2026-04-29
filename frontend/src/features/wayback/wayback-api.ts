import { invokeCommand } from '@/lib/tauri'
import type {
  CreateTaskResult,
  DownloadRequest,
  Nullable,
  ScanWaybackResponse,
  WaybackIncrementalRequest,
  WaybackIncrementalResult,
  WaybackScanProgress,
  WaybackScanRequest,
  WaybackVersion,
} from '@/types/api'

export function getWaybackVersions(proxy: Nullable<string>) {
  return invokeCommand<WaybackVersion[]>('get_wayback_versions', { proxy: proxy || null })
}

export function createWaybackTask(
  request: DownloadRequest,
  versionId: string,
  versionDate: string,
  taskName: string,
) {
  return invokeCommand<CreateTaskResult>('create_wayback_task', {
    request,
    versionId,
    versionDate,
    taskName,
  })
}

export function probeWaybackMaxZoom(
  versionId: string,
  lat: number,
  lng: number,
  proxy: Nullable<string>,
) {
  return invokeCommand<number>('probe_wayback_max_zoom', { versionId, lat, lng, proxy })
}

export function scanWaybackMetadata(req: WaybackScanRequest) {
  return invokeCommand<ScanWaybackResponse>('scan_wayback_metadata', { req })
}

export function getWaybackScanProgress(scanId: string) {
  return invokeCommand<WaybackScanProgress | null>('get_wayback_scan_progress', { scanId })
}

export function downloadWaybackIncremental(req: WaybackIncrementalRequest) {
  return invokeCommand<WaybackIncrementalResult>('download_wayback_incremental', { req })
}

