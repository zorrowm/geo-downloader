import { invokeCommand } from '@/lib/tauri'
import type {
  Bounds,
  DownloadEstimate,
  DownloadRequest,
  DownloadResult,
  Nullable,
  OutputFormat,
  TileProbeResult,
} from '@/types/api'

export function estimateDownload(
  bounds: Bounds,
  zoom: number,
  format: OutputFormat,
  cropToShape = false,
  zoomMax: Nullable<number> = null,
) {
  return invokeCommand<DownloadEstimate>('estimate_download', {
    bounds,
    zoom,
    zoom_max: zoomMax,
    format: format || null,
    crop_to_shape: cropToShape,
  })
}

export function downloadTiles(request: DownloadRequest) {
  return invokeCommand<DownloadResult>('download_tiles', { request })
}

export function createDownloadTask(request: DownloadRequest, taskName: string, sourceName: string) {
  return invokeCommand<string>('create_download_task', { request, taskName, sourceName })
}

export function probeTile(
  sourceKey: string,
  zoom: number,
  lat: number,
  lng: number,
  tiandituToken: Nullable<string>,
  proxy: Nullable<string>,
) {
  return invokeCommand<TileProbeResult>('probe_tile', {
    sourceKey,
    zoom,
    lat,
    lng,
    tiandituToken: tiandituToken || null,
    proxy: proxy || null,
  })
}
