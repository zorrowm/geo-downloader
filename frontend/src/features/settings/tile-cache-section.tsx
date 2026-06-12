import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask as askDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { FolderSync, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  clearCache,
  getCacheMigrationStatus,
  getCacheStats,
  preflightCacheMigration,
  type CacheMigrationPreflight,
  type CacheMigrationStatus,
  type TileCacheStats,
} from './tile-cache-api'
import { CacheMigrationDialog } from './cache-migration-dialog'

export interface TileCacheSectionProps {
  enabled: boolean
  maxSizeMb: number
  dir: string
  onEnabledChange: (v: boolean) => void
  onMaxSizeMbChange: (v: number) => void
  onDirChange: (v: string) => void
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

export function TileCacheSection({
  enabled,
  maxSizeMb,
  dir,
  onEnabledChange,
  onMaxSizeMbChange,
  onDirChange,
}: TileCacheSectionProps) {
  const queryClient = useQueryClient()
  const [maxGbDraft, setMaxGbDraft] = useState<string | null>(null)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [migrationPreflight, setMigrationPreflight] =
    useState<CacheMigrationPreflight | null>(null)
  const [migrationInitialStatus, setMigrationInitialStatus] =
    useState<CacheMigrationStatus | null>(null)
  const [checkingMigration, setCheckingMigration] = useState(false)

  const statsQuery = useQuery<TileCacheStats>({
    queryKey: ['tile-cache-stats'],
    queryFn: getCacheStats,
    refetchOnWindowFocus: false,
  })
  const migrationStatusQuery = useQuery({
    queryKey: ['cache-migration-status'],
    queryFn: getCacheMigrationStatus,
    refetchOnWindowFocus: false,
  })

  const clearMutation = useMutation({
    mutationFn: (source: string | undefined) => clearCache(source),
    onSuccess: (freed, source) => {
      toast.success(
        source
          ? `已清理 ${source}（释放 ${formatBytes(freed)}）`
          : `已清空全部缓存（释放 ${formatBytes(freed)}）`,
      )
      queryClient.invalidateQueries({ queryKey: ['tile-cache-stats'] })
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`清理失败：${msg}`)
    },
  })

  const handleMigrate = async () => {
    const current = (statsQuery.data?.rootDir ?? dir ?? '').trim()
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: current || undefined,
    })
    if (typeof picked === 'string' && picked.trim()) {
      setCheckingMigration(true)
      try {
        const result = await preflightCacheMigration(picked)
        setMigrationInitialStatus(null)
        setMigrationPreflight(result)
        setMigrationOpen(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(`迁移预检失败：${msg}`)
      } finally {
        setCheckingMigration(false)
      }
    }
  }

  const handleClearAll = async () => {
    const ok = await askDialog('确定要清空所有瓦片缓存吗？该操作不可恢复。', {
      title: '清空瓦片缓存',
      kind: 'warning',
    })
    if (ok) clearMutation.mutate(undefined)
  }

  const stats = statsQuery.data
  const recordedMigration = migrationStatusQuery.data
  const usedBytes = stats?.usedBytes ?? 0
  const maxBytes = (stats?.maxTotalBytes ?? 0) || maxSizeMb * 1024 * 1024
  const maxGb = maxGbDraft ?? String(Math.max(0, maxSizeMb / 1024))
  const percent =
    maxBytes > 0 ? Math.min(100, Math.round((usedBytes / maxBytes) * 100)) : 0

  const handleMaxGbBlur = () => {
    const n = Number.parseFloat(maxGb)
    if (!Number.isFinite(n) || n < 0) {
      setMaxGbDraft(null)
      return
    }
    onMaxSizeMbChange(Math.round(n * 1024))
    setMaxGbDraft(null)
  }

  const handleOpenRecordedMigration = () => {
    if (!recordedMigration) return
    setMigrationInitialStatus(recordedMigration)
    setMigrationPreflight({
      sourceDir: recordedMigration.sourceDir,
      targetDir: recordedMigration.targetDir,
      totalBytes: recordedMigration.totalBytes,
      fileCount: recordedMigration.fileCount,
      availableBytes: 0,
      requiredBytes: recordedMigration.totalBytes,
      canStart: false,
      blockers: [],
      warnings: [],
    })
    setMigrationOpen(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div className="min-w-0 pr-2">
          <Label className="text-sm">启用瓦片缓存</Label>
          <p className="text-xs text-muted-foreground">
            浏览过的瓦片自动落盘，下次免重复请求
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tile_cache_max_gb">容量上限 GB（0 = 不限）</Label>
        <Input
          id="tile_cache_max_gb"
          type="number"
          min={0}
          max={1024}
          step="0.5"
          value={maxGb}
          onChange={(e) => setMaxGbDraft(e.target.value)}
          onBlur={handleMaxGbBlur}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tile_cache_dir">当前缓存目录</Label>
        <div className="flex gap-2">
          <Input
            id="tile_cache_dir"
            value={stats?.rootDir ?? dir}
            readOnly
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleMigrate}
            disabled={checkingMigration}
          >
            {checkingMigration ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderSync className="size-3.5" />
            )}
            迁移
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          迁移会复制并校验全部缓存，成功后才切换目录，旧缓存默认保留。
        </p>
      </div>

      {recordedMigration &&
        (recordedMigration.status === 'completed' ||
          recordedMigration.status === 'failed' ||
          recordedMigration.status === 'cancelled') && (
          <div className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {recordedMigration.status === 'completed'
                  ? '上次缓存迁移已完成'
                  : '有未完成的缓存迁移'}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {recordedMigration.message}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleOpenRecordedMigration}>
              处理
            </Button>
          </div>
        )}

      <div className="rounded-md border p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">已用容量</span>
          <span className="font-medium">
            {formatBytes(usedBytes)}
            {maxBytes > 0 ? ` / ${formatBytes(maxBytes)}` : ' / 不限'}
          </span>
        </div>
        {maxBytes > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b px-2.5 py-2">
          <span className="text-xs font-medium">分图源占用</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => statsQuery.refetch()}
            disabled={statsQuery.isFetching}
          >
            {statsQuery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        </div>
        {statsQuery.isLoading ? (
          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
            <Loader2 className="mr-1 size-3.5 animate-spin" />
            加载中...
          </div>
        ) : stats && stats.sources.length > 0 ? (
          <ul className="max-h-48 divide-y overflow-auto text-xs">
            {stats.sources.map((s) => (
              <li
                key={s.source}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={s.source}>
                    {s.displayName || s.source}
                  </div>
                  <div className="text-muted-foreground">
                    {s.tileCount} 块 · {formatBytes(s.sizeBytes)}
                    {s.maxZoom != null ? ` · z≤${s.maxZoom}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => clearMutation.mutate(s.source)}
                  disabled={clearMutation.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-2.5 py-3 text-xs text-muted-foreground">暂无缓存</div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-destructive hover:text-destructive"
        onClick={handleClearAll}
        disabled={clearMutation.isPending || (stats?.sources.length ?? 0) === 0}
      >
        <Trash2 className="mr-1 size-3.5" />
        清空全部缓存
      </Button>

      {migrationOpen && (
        <CacheMigrationDialog
          open
          preflight={migrationPreflight}
          initialStatus={migrationInitialStatus}
          onOpenChange={(next) => {
            setMigrationOpen(next)
            if (!next) {
              queryClient.invalidateQueries({ queryKey: ['cache-migration-status'] })
            }
          }}
          onCompleted={(targetDir) => {
            onDirChange(targetDir)
            queryClient.invalidateQueries({ queryKey: ['tile-cache-stats'] })
            queryClient.invalidateQueries({ queryKey: ['settings'] })
            queryClient.invalidateQueries({ queryKey: ['cache-migration-status'] })
          }}
        />
      )}
    </div>
  )
}
