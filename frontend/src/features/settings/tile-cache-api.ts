import { invokeCommand } from '@/lib/tauri'

export interface TileCacheSourceStats {
  source: string
  displayName: string
  format: string
  tileCount: number
  sizeBytes: number
  minZoom: number | null
  maxZoom: number | null
  createdAt: string | null
  lastUsedAt: string | null
}

export interface TileCacheStats {
  rootDir: string
  enabled: boolean
  maxTotalBytes: number
  usedBytes: number
  sources: TileCacheSourceStats[]
}

export function getCacheStats() {
  return invokeCommand<TileCacheStats>('cache_stats')
}

export function clearCache(source?: string) {
  return invokeCommand<number>('cache_clear', { source: source ?? null })
}

export function setCacheMaxSizeMb(mb: number) {
  return invokeCommand<number>('cache_set_max_size_mb', { mb })
}

export function setCacheDir(dir: string | null) {
  return invokeCommand<string>('cache_set_dir', { dir })
}

export function setCacheEnabled(enabled: boolean) {
  return invokeCommand<void>('cache_set_enabled', { enabled })
}
