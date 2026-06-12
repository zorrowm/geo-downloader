import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ask as askDialog } from '@tauri-apps/plugin-dialog'
import { CheckCircle2, FolderSync, Loader2, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  cancelCacheMigration,
  cleanupCacheMigrationStaging,
  deleteCacheMigrationSource,
  getCacheMigrationStatus,
  startCacheMigration,
  type CacheMigrationPreflight,
  type CacheMigrationStatus,
} from './tile-cache-api'

interface CacheMigrationDialogProps {
  open: boolean
  preflight: CacheMigrationPreflight | null
  initialStatus?: CacheMigrationStatus | null
  onOpenChange: (open: boolean) => void
  onCompleted: (targetDir: string) => void
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`
}

function isRunning(status: CacheMigrationStatus | null) {
  return (
    status?.status === 'preflight' ||
    status?.status === 'copying' ||
    status?.status === 'verifying' ||
    status?.status === 'committing'
  )
}

export function CacheMigrationDialog({
  open,
  preflight,
  initialStatus = null,
  onOpenChange,
  onCompleted,
}: CacheMigrationDialogProps) {
  const [status, setStatus] = useState<CacheMigrationStatus | null>(initialStatus)
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listen<CacheMigrationStatus>('cache-migration-progress', (event) => {
      if (cancelled) return
      setStatus(event.payload)
      if (event.payload.status === 'completed') {
        onCompleted(event.payload.targetDir)
      }
    })
      .then((unlisten) => {
        if (cancelled) unlisten()
        else unlistenRef.current = unlisten
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [open, onCompleted])

  if (!preflight) return null

  const running = isRunning(status)
  const cancellable =
    status?.status === 'preflight' ||
    status?.status === 'copying' ||
    status?.status === 'verifying'
  const completed = status?.status === 'completed'
  const failed = status?.status === 'failed' || status?.status === 'cancelled'
  const verifying = status?.status === 'verifying'
  const committing = status?.status === 'committing'
  const percent = Math.max(0, Math.min(100, status?.percent ?? 0))

  const handleOpenChange = (next: boolean) => {
    if (!next && (running || starting)) return
    onOpenChange(next)
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      await startCacheMigration(preflight.targetDir)
      const current = await getCacheMigrationStatus()
      if (current) {
        setStatus(current)
        if (current.status === 'completed') {
          onCompleted(current.targetDir)
        }
      }
    } catch (error) {
      toast.error(`启动迁移失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStarting(false)
    }
  }

  const handleCancel = async () => {
    if (!status?.migrationId) return
    const ok = await askDialog('确定取消迁移吗？原缓存不会受到影响。', {
      title: '取消缓存迁移',
      kind: 'warning',
    })
    if (!ok) return
    try {
      await cancelCacheMigration(status.migrationId)
    } catch (error) {
      toast.error(`取消失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleDeleteSource = async () => {
    if (!status?.migrationId) return
    const ok = await askDialog(
      `确定删除旧缓存吗？\n\n${status.sourceDir}\n\n预计释放 ${formatBytes(status.totalBytes)}，此操作不可恢复。`,
      { title: '删除旧缓存', kind: 'warning' },
    )
    if (!ok) return
    setDeleting(true)
    try {
      const freed = await deleteCacheMigrationSource(status.migrationId)
      toast.success(`旧缓存已删除，释放 ${formatBytes(freed)}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleCleanupStaging = async () => {
    if (!status?.migrationId) return
    setCleaning(true)
    try {
      const freed = await cleanupCacheMigrationStaging(status.migrationId)
      toast.success(`迁移临时文件已清理，释放 ${formatBytes(freed)}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(`清理失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCleaning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="size-5" />
            迁移瓦片缓存
          </DialogTitle>
          <DialogDescription>
            完成并校验前始终使用原目录，旧缓存不会被自动删除。
          </DialogDescription>
        </DialogHeader>

        {!status && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 rounded-md border p-3">
              <div>
                <div className="text-xs text-muted-foreground">当前位置</div>
                <div className="break-all font-medium">{preflight.sourceDir}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">目标位置</div>
                <div className="break-all font-medium">{preflight.targetDir}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="text-xs text-muted-foreground">缓存数据</div>
                  <div className="font-medium">
                    {formatBytes(preflight.totalBytes)} · {preflight.fileCount} 个文件
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">目标盘可用</div>
                  <div className="font-medium">{formatBytes(preflight.availableBytes)}</div>
                </div>
              </div>
            </div>
            {preflight.blockers.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                {preflight.blockers.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            )}
            {preflight.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                {preflight.warnings.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {status && !completed && !failed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="font-medium">{status.message}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="max-w-[70%] truncate" title={status.currentFile ?? ''}>
                  {status.currentFile ?? '准备中'}
                </span>
                <span className="tabular-nums">{percent.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {verifying
                    ? `已校验 ${status.fileIndex} / ${status.fileCount} 个文件`
                    : `${status.fileIndex} / ${status.fileCount} 个文件`}
                </span>
                <span>
                  {committing
                    ? '正在完成目录切换'
                    : verifying
                      ? `已复制 ${formatBytes(status.copiedBytes)}`
                      : `${formatBytes(status.copiedBytes)} / ${formatBytes(status.totalBytes)}`}
                </span>
              </div>
            </div>
          </div>
        )}

        {completed && status && (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <div className="font-medium">缓存迁移完成</div>
                <div className="mt-1 break-all">{status.targetDir}</div>
              </div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-xs text-muted-foreground">旧缓存仍保留在</div>
              <div className="mt-1 break-all">{status.sourceDir}</div>
            </div>
          </div>
        )}

        {failed && status && (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="size-5 shrink-0" />
            <div>
              <div className="font-medium">{status.message}</div>
              {status.error && <div className="mt-1">{status.error}</div>}
            </div>
          </div>
        )}

        <DialogFooter>
          {!status && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="button"
                onClick={handleStart}
                disabled={!preflight.canStart || starting}
              >
                {starting && <Loader2 className="size-4 animate-spin" />}
                开始迁移
              </Button>
            </>
          )}
          {cancellable && (
            <Button type="button" variant="outline" onClick={handleCancel}>
              取消迁移
            </Button>
          )}
          {completed && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                稍后处理
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteSource}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                删除旧缓存
              </Button>
            </>
          )}
          {failed && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                稍后处理
              </Button>
              <Button type="button" onClick={handleCleanupStaging} disabled={cleaning}>
                {cleaning && <Loader2 className="size-4 animate-spin" />}
                清理临时文件
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
