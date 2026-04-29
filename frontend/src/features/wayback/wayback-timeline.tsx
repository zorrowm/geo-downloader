import { useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAppStore } from '@/store/app-store'
import { useWaybackStore } from '@/store/wayback-store'
import { getSettings } from '@/features/settings/settings-api'
import { getWaybackVersions } from '@/features/wayback/wayback-api'

export function WaybackTimeline() {
  const mode = useAppStore((s) => s.mode)
  const previewVersionId = useWaybackStore((s) => s.previewVersionId)
  const setPreviewVersionId = useWaybackStore((s) => s.setPreviewVersionId)
  const visible = mode === 'wayback'

  // 复用 wayback-page 的缓存（同一 queryKey）
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getSettings,
    enabled: visible,
  })
  const proxy = useMemo(() => {
    if (!settingsQuery.data?.proxy_enabled) return null
    return settingsQuery.data.proxy_url || null
  }, [settingsQuery.data])

  const versionsQuery = useQuery({
    queryKey: ['wayback-versions', proxy ?? ''],
    queryFn: () => getWaybackVersions(proxy),
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  })

  // 升序版本：oldest → newest（与旧版一致）
  const ascending = useMemo(() => {
    const list = versionsQuery.data ?? []
    return [...list].reverse()
  }, [versionsQuery.data])

  // 当 previewVersionId 为空时，自动选最新（数组末尾）
  useEffect(() => {
    if (!visible) return
    if (!ascending.length) return
    if (previewVersionId == null || !ascending.find((v) => v.id === previewVersionId)) {
      setPreviewVersionId(ascending[ascending.length - 1].id)
    }
  }, [visible, ascending, previewVersionId, setPreviewVersionId])

  if (!visible) return null
  if (!ascending.length) return null

  const currentIdx = Math.max(
    0,
    ascending.findIndex((v) => v.id === previewVersionId),
  )
  const current = ascending[currentIdx]
  const total = ascending.length

  // 年份刻度
  const yearLabels = (() => {
    const years = Array.from(new Set(ascending.map((v) => v.date.slice(0, 4)))).sort()
    const step = Math.max(1, Math.ceil(years.length / 12))
    const result: string[] = []
    for (let i = 0; i < years.length; i += step) result.push(years[i])
    if (years.length && result[result.length - 1] !== years[years.length - 1]) {
      result.push(years[years.length - 1])
    }
    return result
  })()

  function setIndex(idx: number) {
    const clamped = Math.max(0, Math.min(total - 1, idx))
    const v = ascending[clamped]
    if (v) setPreviewVersionId(v.id)
  }

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-[450] rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setIndex(currentIdx - 1)}
          disabled={currentIdx <= 0}
          title="上一版本"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="w-32 shrink-0 text-center text-sm font-medium tabular-nums">
          {current?.date ?? '--'}
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({currentIdx + 1}/{total})
          </span>
        </div>
        <div className="relative flex-1">
          <Slider
            value={[currentIdx]}
            onValueChange={(v) => setIndex(v[0] ?? 0)}
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
          />
          {/* 影像日期刻度：细竖线，悬浮显示日期 */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2">
            {ascending.map((v, i) => {
              const left = total === 1 ? 0 : (i / (total - 1)) * 100
              const active = i === currentIdx
              return (
                <span
                  key={v.id}
                  className={
                    'pointer-events-auto absolute top-0 h-3 w-px -translate-x-1/2 cursor-pointer transition-colors hover:w-0.5 hover:bg-primary ' +
                    (active ? 'bg-primary' : 'bg-muted-foreground/50')
                  }
                  style={{ left: `${left}%` }}
                  title={v.date}
                  onClick={() => setIndex(i)}
                />
              )
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            {yearLabels.map((y) => (
              <span key={y}>{y}</span>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setIndex(currentIdx + 1)}
          disabled={currentIdx >= total - 1}
          title="下一版本"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
