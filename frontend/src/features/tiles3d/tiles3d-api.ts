import { invokeCommand } from '@/lib/tauri'
import type { Nullable, Polygon, Tiles3dSource, Tiles3dTaskRequest } from '@/types/api'

export function analyze3dTiles(source: Tiles3dSource, proxy: Nullable<string>) {
  return invokeCommand<unknown>('analyze_3dtiles', { source, proxy: proxy || null })
}

export function estimate3dTiles(source: Tiles3dSource, polygon: Nullable<Polygon>, proxy: Nullable<string>) {
  return invokeCommand<unknown>('estimate_3dtiles', { source, polygon, proxy: proxy || null })
}

export function create3dTilesTask(request: Tiles3dTaskRequest, taskName: string) {
  return invokeCommand<string>('create_3dtiles_task', { request, taskName })
}

export function startTileProxy(baseUrl: string, headers: Record<string, string> = {}) {
  return invokeCommand<string>('start_tile_proxy', { baseUrl, headers })
}

export function serveLocalTiles(dirPath: string) {
  return invokeCommand<string>('serve_local_tiles', { dirPath })
}
