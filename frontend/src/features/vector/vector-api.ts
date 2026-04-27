import { invokeCommand } from '@/lib/tauri'
import type { Bounds, Nullable, Polygon } from '@/types/api'

export function createOsmDownloadTask(
  bounds: Bounds,
  featureType: string,
  savePath: string,
  proxy: Nullable<string>,
  polygon: Nullable<Polygon>,
  taskName: string,
) {
  return invokeCommand<string>('create_osm_download_task', {
    bounds,
    featureType,
    savePath,
    proxy: proxy || null,
    polygon: polygon || null,
    taskName,
  })
}

export function downloadOsmData(
  bounds: Bounds,
  featureType: string,
  savePath: string,
  proxy: Nullable<string>,
  polygon: Nullable<Polygon>,
) {
  return invokeCommand<unknown>('download_osm_data', {
    bounds,
    featureType,
    savePath,
    proxy: proxy || null,
    polygon: polygon || null,
  })
}
