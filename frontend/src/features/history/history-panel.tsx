import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ask as askDialog } from '@tauri-apps/plugin-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FolderOpen,
  Inbox,
  Layers,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { isTauriRuntime } from '@/lib/tauri'
import {
  buildPyramidForFile,
  clearDownloadHistory,
  deleteDownloadRecord,
  getDownloadHistory,
  openFileLocation,
} from '@/features/history/history-api'
import { readLogFile } from '@/features/tasks/tasks-api'
import type { DownloadHistoryRecord, TaskLog } from '@/types/api'

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(2)} ${units[i]}`
}

function formatDuration(secs?: number): string | null {
  if (!secs || secs <= 0) return null
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

function formatDate(iso?: string): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

interface PyramidProgressPayload {
  record_id: string
  current: number
  total: number
}

function HistoryLogPanel({ logFile }: { logFile: string }) {
  const [logs, setLogs] = useState<TaskLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLogs(null)
    setError(null)
    readLogFile(logFile)
      .then((arr) => {
        if (!cancelled) setLogs(arr)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [logFile])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const onCopy = useCallback(async () => {
    if (!logs) return
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('日志已复制')
    } catch {
      toast.error('复制失败')
    }
  }, [logs])

  return (
    <div className="mt-2 rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="text-xs text-muted-foreground">
          日志 {logs ? `(${logs.length})` : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCopy}
          className="h-6 gap-1 px-2 text-xs"
          disabled={!logs || logs.length === 0}
        >
          <ClipboardCopy className="size-3" />
          复制
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {error && <p className="text-destructive">读取日志失败：{error}</p>}
        {!error && !logs && <p className="text-muted-foreground">加载中...</p>}
        {!error && logs && logs.length === 0 && (
          <p className="text-muted-foreground">日志文件为空或已删除</p>
        )}
        {!error &&
          logs?.map((l, i) => {
            const cls =
              l.level === 'ERROR'
                ? 'text-destructive'
                : l.level === 'WARN'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-foreground/80'
            return (
              <div key={i} className={cls}>
                <span className="text-muted-foreground">{l.timestamp}</span> {l.message}
              </div>
            )
          })}
      </div>
    </div>
  )
}

function HistoryCard({
  record,
  pyramidProgress,
}: {
  record: DownloadHistoryRecord
  pyramidProgress?: PyramidProgressPayload
}) {
  const qc = useQueryClient()
  const [showLogs, setShowLogs] = useState(false)
  const id = String(record.id)
  const isFailed =
    record.success === false ||
    (typeof record.status === 'string' && record.status === 'failed')
  const filePath = (record.file_path as string | undefined) ?? ''
  const logFile = (record.log_file as string | undefined) ?? ''
  const isTiff =
    record.format === 'geotiff' || (filePath && filePath.toLowerCase().endsWith('.tif'))
  const hasPyramid = Boolean(record.has_pyramid)
  const canBuildPyramid = !isFailed && Boolean(filePath) && Boolean(isTiff) && !hasPyramid
  const duration = formatDuration(record.duration_secs as number | undefined)

  const openMutation = useMutation({
    mutationFn: () => openFileLocation(filePath),
    onError: (e) => toast.error(`打开文件夹失败：${String(e)}`),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const ok = await askDialog('确定删除这条记录？此操作不会删除已下载的文件。', {
        title: '删除记录',
        kind: 'warning',
      })
      if (!ok) return false
      await deleteDownloadRecord(id)
      return true
    },
    onSuccess: (changed) => {
      if (changed) qc.invalidateQueries({ queryKey: ['download-history'] })
    },
    onError: (e) => toast.error(`删除失败：${String(e)}`),
  })
  const pyramidMutation = useMutation({
    mutationFn: () => buildPyramidForFile(id, filePath),
    onSuccess: () => {
      toast.success('金字塔构建完成')
      qc.invalidateQueries({ queryKey: ['download-history'] })
    },
    onError: (e) => toast.error(`金字塔构建失败：${String(e)}`),
  })

  const pyramidLabel = (() => {
    if (pyramidMutation.isPending) {
      if (pyramidProgress) {
        return `金字塔 ${pyramidProgress.current + 1}/${pyramidProgress.total}`
      }
      return '构建中...'
    }
    return '构建金字塔'
  })()

  return (
    <div className="rounded-md border p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate font-medium" title={record.name}>
          {record.name}
        </span>
        <Badge variant={isFailed ? 'destructive' : 'default'} className="text-xs">
          {isFailed ? '失败' : '完成'}
        </Badge>
        {hasPyramid && (
          <Badge variant="outline" className="text-xs font-normal">
            pyramid
          </Badge>
        )}
        {record.source_name && (
          <Badge variant="outline" className="text-xs font-normal">
            {String(record.source_name)}
          </Badge>
        )}
        {typeof record.zoom === 'number' && record.zoom > 0 && (
          <Badge variant="outline" className="text-xs font-normal">
            z{record.zoom}
          </Badge>
        )}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {typeof record.tile_count === 'number' && record.tile_count > 0 && (
          <span>
            {record.tile_count.toLocaleString()}{' '}
            {typeof record.zoom === 'number' && record.zoom > 0 ? '瓦片' : '节点'}
          </span>
        )}
        {typeof record.file_size === 'number' && record.file_size > 0 && (
          <span>{formatBytes(record.file_size)}</span>
        )}
        {duration && <span>耗时 {duration}</span>}
        <span>{formatDate(record.created_at)}</span>
      </div>

      {!isFailed && filePath && (
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={filePath}>
          {filePath}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {!isFailed && filePath && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openMutation.mutate()}
            disabled={openMutation.isPending}
            className="h-7 gap-1 text-xs"
          >
            <FolderOpen className="size-3" />
            打开文件夹
          </Button>
        )}
        {canBuildPyramid && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => pyramidMutation.mutate()}
            disabled={pyramidMutation.isPending}
            className="h-7 gap-1 text-xs"
          >
            <Layers className="size-3" />
            {pyramidLabel}
          </Button>
        )}
        {logFile && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowLogs((v) => !v)}
            className="h-7 gap-1 text-xs"
          >
            {showLogs ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            日志
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="ml-auto h-7 gap-1 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3" />
          删除
        </Button>
      </div>

      {showLogs && logFile && <HistoryLogPanel logFile={logFile} />}
    </div>
  )
}

export function HistoryPanel() {
  const qc = useQueryClient()
  const inTauri = isTauriRuntime()
  const [pyramidProgress, setPyramidProgress] = useState<Map<string, PyramidProgressPayload>>(
    () => new Map(),
  )

  const historyQuery = useQuery({
    queryKey: ['download-history'],
    queryFn: getDownloadHistory,
    enabled: inTauri,
  })

  // 监听金字塔构建进度
  useEffect(() => {
    if (!inTauri) return
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<PyramidProgressPayload>('pyramid-progress', (e) => {
      const p = e.payload
      setPyramidProgress((prev) => {
        const next = new Map(prev)
        if (p.current + 1 >= p.total) {
          next.delete(p.record_id)
        } else {
          next.set(p.record_id, p)
        }
        return next
      })
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [inTauri])

  // 监听任务完成事件，自动刷新历史
  useEffect(() => {
    if (!inTauri) return
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen('task-list-updated', () => {
      qc.invalidateQueries({ queryKey: ['download-history'] })
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [inTauri, qc])

  const clearMutation = useMutation({
    mutationFn: async () => {
      const ok = await askDialog(
        '确定清空所有下载记录？\n此操作不会删除已下载的文件。',
        { title: '清空记录', kind: 'warning' },
      )
      if (!ok) return false
      await clearDownloadHistory()
      return true
    },
    onSuccess: (changed) => {
      if (changed) {
        toast.success('已清空历史记录')
        qc.invalidateQueries({ queryKey: ['download-history'] })
      }
    },
    onError: (e) => toast.error(`清空失败：${String(e)}`),
  })

  const records = useMemo(() => historyQuery.data ?? [], [historyQuery.data])

  if (!inTauri) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        非 Tauri 环境，历史记录不可用
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          共 <span className="font-semibold text-foreground">{records.length}</span> 条记录
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => historyQuery.refetch()}
            disabled={historyQuery.isFetching}
            className="size-7"
            title="刷新"
          >
            <RefreshCw
              className={`size-3.5 ${historyQuery.isFetching ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || records.length === 0}
            className="size-7"
            title="清空记录"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {historyQuery.isLoading && <p className="text-xs text-muted-foreground">加载中...</p>}
      {!historyQuery.isLoading && records.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-xs text-muted-foreground">
          <Inbox className="size-7 opacity-50" />
          <p>暂无下载记录</p>
        </div>
      )}
      {records.map((r) => (
        <HistoryCard
          key={String(r.id)}
          record={r}
          pyramidProgress={pyramidProgress.get(String(r.id))}
        />
      ))}
    </div>
  )
}
