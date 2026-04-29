import { invokeCommand } from '@/lib/tauri'
import type { Bounds, CreateTaskResult, Nullable, PolygonCoord } from '@/types/api'

export function createOsmDownloadTask(
  bounds: Bounds,
  featureType: string,
  savePath: string,
  proxy: Nullable<string>,
  polygon: Nullable<PolygonCoord[]>,
  taskName: string,
) {
  return invokeCommand<CreateTaskResult>('create_osm_download_task', {
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
  polygon: Nullable<PolygonCoord[]>,
) {
  return invokeCommand<unknown>('download_osm_data', {
    bounds,
    featureType,
    savePath,
    proxy: proxy || null,
    polygon: polygon || null,
  })
}
