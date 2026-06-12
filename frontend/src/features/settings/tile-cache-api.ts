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

export interface CacheMigrationPreflight {
  sourceDir: string
  targetDir: string
  totalBytes: number
  fileCount: number
  availableBytes: number
  requiredBytes: number
  canStart: boolean
  blockers: string[]
  warnings: string[]
}

export type CacheMigrationPhase =
  | 'preflight'
  | 'copying'
  | 'verifying'
  | 'committing'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface CacheMigrationStatus {
  migrationId: string
  status: CacheMigrationPhase
  sourceDir: string
  targetDir: string
  stagingDir: string
  currentFile: string | null
  fileIndex: number
  fileCount: number
  copiedBytes: number
  totalBytes: number
  percent: number
  message: string
  error: string | null
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

export function preflightCacheMigration(targetDir: string) {
  return invokeCommand<CacheMigrationPreflight>('cache_migration_preflight', { targetDir })
}

export function startCacheMigration(targetDir: string) {
  return invokeCommand<{ migrationId: string }>('cache_migration_start', { targetDir })
}

export function getCacheMigrationStatus() {
  return invokeCommand<CacheMigrationStatus | null>('cache_migration_status')
}

export function cancelCacheMigration(migrationId: string) {
  return invokeCommand<void>('cache_migration_cancel', { migrationId })
}

export function cleanupCacheMigrationStaging(migrationId: string) {
  return invokeCommand<number>('cache_migration_cleanup_staging', { migrationId })
}

export function deleteCacheMigrationSource(migrationId: string) {
  return invokeCommand<number>('cache_migration_delete_source', { migrationId })
}
