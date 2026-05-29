import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ask as askDialog } from '@tauri-apps/plugin-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Inbox,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { isTauriRuntime } from '@/lib/tauri'
import { useAppStore } from '@/store/app-store'
import {
  cancelTask,
  discardResumableTask,
  exportPartialTask,
  getActiveTasks,
  getResumableTasks,
  getTaskLogs,
  removeTask,
  resumeTask,
  togglePauseTask,
} from '@/features/tasks/tasks-api'
import type { PersistedTask, TaskInfo, TaskLog, TaskStatus } from '@/types/api'

const ACTIVE_STATES: TaskStatus[] = [
  'pending',
  'downloading',
  'merging',
  'processing',
  'exporting',
  'building_pyramid',
]
// FINISHED_STATES：列入此集合的任务会从活动面板隐藏并转入历史。
// `completed_with_gaps` 故意不列入 — 设计稿要求"显示在已完成区，带醒目缺块徽章"，
// 让用户在主面板能立即看到并选择「补漏重导」/「删除」。
const FINISHED_STATES: TaskStatus[] = ['completed', 'failed', 'cancelled']

function isActive(s: string): boolean {
  return ACTIVE_STATES.includes(s as TaskStatus) || s === 'paused' || s === 'pending_decision'
}
function isFinished(s: string): boolean {
  return FINISHED_STATES.includes(s as TaskStatus)
}
function isCompletedWithGaps(s: string): boolean {
  return s === 'completed_with_gaps'
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'completed') return 'default'
  if (s === 'failed' || s === 'cancelled') return 'destructive'
  if (s === 'paused' || s === 'pending_decision' || s === 'completed_with_gaps') return 'outline'
  return 'secondary'
}

const STATUS_TEXT: Record<string, string> = {
  pending: '等待中',
  downloading: '下载中',
  paused: '已暂停',
  pending_decision: '待决策',
  merging: '拼接中',
  processing: '处理中',
  exporting: '导出中',
  building_pyramid: '构建金字塔',
  completed: '已完成',
  completed_with_gaps: '部分完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusLabel(s: string): string {
  return STATUS_TEXT[s] ?? s
}

/**
 * Issue #31：按缺块比例返回 Tailwind 文字 / 边框色（绿黄橙红四档）。
 * < 1% 绿，1-10% 黄，10-50% 橙，> 50% 红。
 */
function gapBadgeClasses(failedRatio: number): string {
  if (failedRatio <= 0.01) {
    return 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
  }
  if (failedRatio <= 0.1) {
    return 'border-amber-500/50 text-amber-700 dark:text-amber-400'
  }
  if (failedRatio <= 0.5) {
    return 'border-orange-500/50 text-orange-700 dark:text-orange-400'
  }
  return 'border-red-500/50 text-red-700 dark:text-red-400'
}

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

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-primary transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// 任务起始时间记录（任务首次出现时锚定）
const taskStartTimes = new Map<string, number>()

function getStartTime(taskId: string): number {
  const cached = taskStartTimes.get(taskId)
  if (cached) return cached
  const now = Date.now()
  taskStartTimes.set(taskId, now)
  return now
}

function TaskLogPanel({ taskId }: { taskId: string }) {
  const [logs, setLogs] = useState<TaskLog[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inTauri = isTauriRuntime()

  // 初次拉取已有日志
  useEffect(() => {
    if (!inTauri) return
    let cancelled = false
    getTaskLogs(taskId)
      .then((arr) => {
        if (!cancelled) setLogs(arr.slice(-500))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [inTauri, taskId])

  // 实时追加
  useEffect(() => {
    if (!inTauri) return
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<TaskLog>(`task-log-${taskId}`, (e) => {
      setLogs((prev) => {
        const next = [...prev, e.payload]
        return next.length > 500 ? next.slice(-500) : next
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
  }, [inTauri, taskId])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const onCopy = useCallback(async () => {
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
        <span className="text-xs text-muted-foreground">日志 ({logs.length})</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCopy}
          className="h-6 gap-1 px-2 text-xs"
          disabled={logs.length === 0}
        >
          <ClipboardCopy className="size-3" />
          复制
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground">暂无日志</p>
        ) : (
          logs.map((l, i) => {
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
          })
        )}
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TaskInfo }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['active-tasks'] })
  const [showLogs, setShowLogs] = useState(false)
  const [elapsed, setElapsed] = useState<number>(0)
  const inTauri = isTauriRuntime()

  // 计时器：活动状态时滚动；暂停 / 结束后冻结当前时长
  useEffect(() => {
    const start = getStartTime(task.id)
    const status = String(task.status)
    if (isFinished(status) || status === 'paused' || status === 'pending_decision') {
      setElapsed(Date.now() - start)
      return
    }
    const update = () => setElapsed(Date.now() - start)
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [task.id, task.status])

  // 订阅本任务进度事件，触发列表刷新（保证状态变化即时）
  useEffect(() => {
    if (!inTauri) return
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen(`task-progress-${task.id}`, () => {
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
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
  }, [inTauri, qc, task.id])

  const pauseMutation = useMutation({
    mutationFn: () => togglePauseTask(task.id),
    onSuccess: refresh,
    onError: (e) => toast.error(`操作失败：${String(e)}`),
  })
  const cancelMutation = useMutation({
    mutationFn: () => cancelTask(task.id),
    onSuccess: () => {
      toast.success('任务已取消')
      refresh()
    },
    onError: (e) => toast.error(`取消失败：${String(e)}`),
  })
  const removeMutation = useMutation({
    mutationFn: () => removeTask(task.id),
    onSuccess: () => {
      taskStartTimes.delete(task.id)
      refresh()
    },
    onError: (e) => toast.error(`删除失败：${String(e)}`),
  })
  // Issue #31：强制按现状导出（paused 待决策时使用）
  const exportPartialMutation = useMutation({
    mutationFn: () => exportPartialTask(task.id),
    onSuccess: () => {
      toast.success('开始强制按现状导出，请等待完成')
      refresh()
    },
    onError: (e) => toast.error(`强制导出失败：${String(e)}`),
  })
  // Issue #31：补漏重导（completed_with_gaps 时使用，复用 resumeTask 触发增量补下载）
  const resumeMutation = useMutation({
    mutationFn: () => resumeTask(task.id),
    onSuccess: () => {
      toast.success('开始补漏重试，将仅下载缺失瓦片')
      refresh()
    },
    onError: (e) => toast.error(`补漏失败：${String(e)}`),
  })

  const status = String(task.status)
  const progress = typeof task.progress === 'number' ? task.progress : 0
  const total = task.total ?? 0
  const completed = task.completed ?? 0
  const failedCount = task.failed_count ?? 0
  // Issue #31：缺块比例（仅在 completed_with_gaps 状态展示徽章用）
  const gapsRatio = total > 0 ? failedCount / total : 0
  const showGapBadge = isCompletedWithGaps(status) && failedCount > 0

  return (
    <div className="rounded-md border p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate font-medium" title={task.name}>
          {task.name}
        </span>
        <Badge variant={statusVariant(status)} className="text-xs">
          {statusLabel(status)}
        </Badge>
        {showGapBadge && (
          <Badge
            variant="outline"
            className={`text-xs ${gapBadgeClasses(gapsRatio)}`}
            title={`缺块 ${failedCount} / ${total}`}
          >
            缺块 {(gapsRatio * 100).toFixed(gapsRatio < 0.01 ? 2 : 1)}%
          </Badge>
        )}
        {task.source_name && (
          <Badge variant="outline" className="text-xs font-normal">
            {task.source_name}
          </Badge>
        )}
        {typeof task.zoom === 'number' && task.zoom > 0 && (
          <Badge variant="outline" className="text-xs font-normal">
            z{task.zoom}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground" title="耗时">
          {formatElapsed(elapsed)}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowLogs((v) => !v)}
            className="size-7"
            title={showLogs ? '收起日志' : '查看日志'}
          >
            {showLogs ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
          {isActive(status) && (
            <>
              {(status === 'downloading' || status === 'paused') && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => pauseMutation.mutate()}
                  disabled={pauseMutation.isPending}
                  className="size-7"
                  title={status === 'paused' ? '恢复' : '暂停'}
                >
                  {status === 'paused' ? (
                    <Play className="size-3.5" />
                  ) : (
                    <Pause className="size-3.5" />
                  )}
                </Button>
              )}
              {/* Issue #31：待决策态加「补漏重试」入口（仅下载缺失瓦片） */}
              {status === 'pending_decision' && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="size-7"
                  title="补漏重试（仅下载缺失瓦片）"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              )}
              {/* Issue #31：暂停 / 待决策态加「强制按现状导出」入口 */}
              {(status === 'paused' || status === 'pending_decision') && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => exportPartialMutation.mutate()}
                  disabled={exportPartialMutation.isPending}
                  className="size-7"
                  title="强制按现状导出（缺块部分留白 / NoData）"
                >
                  <Download className="size-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="size-7"
                title="取消"
              >
                <X className="size-3.5" />
              </Button>
            </>
          )}
          {isCompletedWithGaps(status) && (
            <>
              {/* Issue #31：补漏重导（resume_task 增量下载缺失瓦片） */}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                className="size-7"
                title="补漏重导（仅下载缺失瓦片，完成后覆盖原 TIF）"
              >
                <RefreshCw className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                className="size-7"
                title="从列表移除"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
          {isFinished(status) && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="size-7"
              title="移除"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <ProgressBar value={progress} />
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{progress.toFixed(1)}%</span>
          <span>
            {completed.toLocaleString()} / {total.toLocaleString()}
          </span>
          {typeof task.failed_count === 'number' && task.failed_count > 0 && (
            <span className="text-destructive">失败 {task.failed_count}</span>
          )}
          {task.file_size != null && task.file_size > 0 && (
            <span>{formatBytes(task.file_size)}</span>
          )}
        </div>
        {task.message && (
          <p className="truncate text-xs text-muted-foreground" title={task.message}>
            {task.message}
          </p>
        )}
        {task.error && (
          <p className="truncate text-xs text-destructive" title={task.error}>
            {task.error}
          </p>
        )}
      </div>

      {showLogs && <TaskLogPanel taskId={task.id} />}
    </div>
  )
}

function ResumableRow({ task }: { task: PersistedTask }) {
  const qc = useQueryClient()
  const setTab = useAppStore((s) => s.setTab)

  const resumeMutation = useMutation({
    mutationFn: () => resumeTask(task.task_id),
    onSuccess: (res) => {
      toast.success(`已恢复任务（${res.task_id.slice(0, 8)}）`)
      qc.invalidateQueries({ queryKey: ['resumable-tasks'] })
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
      setTab('history')
    },
    onError: (e) => toast.error(`恢复失败：${String(e)}`),
  })

  const discardMutation = useMutation({
    mutationFn: async () => {
      const ok = await askDialog('确定从列表中移除此任务？', {
        title: '丢弃任务',
        kind: 'warning',
      })
      if (!ok) return false
      // 第二步：是否同时删除已下载的瓦片缓存
      const deleteCache = await askDialog(
        '是否同时删除已下载的瓦片缓存？\n\n选"否"将保留缓存，下次重新创建相同任务时可复用，能少下不下。',
        {
          title: '清理缓存',
          kind: 'warning',
        },
      )
      await discardResumableTask(task.task_id, deleteCache)
      return true
    },
    onSuccess: (changed) => {
      if (changed) qc.invalidateQueries({ queryKey: ['resumable-tasks'] })
    },
    onError: (e) => toast.error(`丢弃失败：${String(e)}`),
  })

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate font-medium" title={task.task_name}>
          {task.task_name}
        </span>
        <Badge
          variant="outline"
          className="border-amber-500/50 text-xs text-amber-600 dark:text-amber-400"
        >
          已中断
        </Badge>
        {task.source_name && (
          <Badge variant="outline" className="text-xs font-normal">
            {task.source_name}
          </Badge>
        )}
        {typeof task.request?.zoom === 'number' && (
          <Badge variant="outline" className="text-xs font-normal">
            z{task.request.zoom}
          </Badge>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{task.tile_count.toLocaleString()} 瓦片</span>
        {task.created_at && <span>{task.created_at}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending}
          className="h-7 text-xs"
        >
          <Play className="mr-1 size-3" />
          继续下载
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => discardMutation.mutate()}
          disabled={discardMutation.isPending}
          className="h-7 text-xs"
        >
          <Trash2 className="mr-1 size-3" />
          丢弃
        </Button>
      </div>
    </div>
  )
}

export function TasksPanel() {
  const qc = useQueryClient()
  const inTauri = isTauriRuntime()

  const tasksQuery = useQuery({
    queryKey: ['active-tasks'],
    queryFn: getActiveTasks,
    enabled: inTauri,
    refetchInterval: 1500,
    refetchIntervalInBackground: true,
  })

  const resumableQuery = useQuery({
    queryKey: ['resumable-tasks'],
    queryFn: getResumableTasks,
    enabled: inTauri,
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!inTauri) return
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen('task-list-updated', () => {
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
      qc.invalidateQueries({ queryKey: ['resumable-tasks'] })
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

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data])
  const resumable = useMemo(() => resumableQuery.data ?? [], [resumableQuery.data])
  const activeCount = useMemo(
    () => tasks.filter((t) => isActive(String(t.status))).length,
    [tasks],
  )
  const finishedCount = useMemo(
    () => tasks.filter((t) => isFinished(String(t.status))).length,
    [tasks],
  )
  // 已完成/失败/取消的任务转入「历史记录」展示，活动列表只保留进行中/暂停
  const visibleTasks = useMemo(
    () => tasks.filter((t) => !isFinished(String(t.status))),
    [tasks],
  )

  if (!inTauri) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        非 Tauri 环境，任务面板不可用
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          活动 <span className="font-semibold text-foreground">{activeCount}</span> · 已结束{' '}
          <span className="font-semibold text-foreground">{finishedCount}</span>
          {resumable.length > 0 && (
            <>
              {' · '}
              中断{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {resumable.length}
              </span>
            </>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            tasksQuery.refetch()
            resumableQuery.refetch()
          }}
          disabled={tasksQuery.isFetching}
          className="size-7"
          title="刷新"
        >
          <RefreshCw className={`size-3.5 ${tasksQuery.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* 中断的任务（断点续传）*/}
      {resumable.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
            中断的任务
          </div>
          {resumable.map((t) => (
            <ResumableRow key={t.task_id} task={t} />
          ))}
        </div>
      )}

      {/* 活动任务 */}
      <div className="space-y-2">
        {resumable.length > 0 && (
          <div className="text-xs font-medium text-muted-foreground">活动任务</div>
        )}
        {tasksQuery.isLoading && <p className="text-xs text-muted-foreground">加载中...</p>}
        {!tasksQuery.isLoading && visibleTasks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-xs text-muted-foreground">
            <Inbox className="size-7 opacity-50" />
            <p>暂无活动任务</p>
            {finishedCount > 0 && (
              <p>已完成 {finishedCount} 项已转入历史记录</p>
            )}
          </div>
        )}
        {visibleTasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}
