import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { Download, History, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { isTauriRuntime } from '@/lib/tauri'
import { PanelSection } from '@/components/layout/panel-section'
import { StatCard } from '@/components/layout/stat-card'
import { RegionSelector } from '@/features/region/region-selector'
import { getSettings } from '@/features/settings/settings-api'
import { estimateDownload } from '@/features/download/download-api'
import { useSelectionStore } from '@/store/selection-store'
import { useAppStore } from '@/store/app-store'
import { useWaybackStore } from '@/store/wayback-store'
import {
  createWaybackTask,
  downloadWaybackIncremental,
  getWaybackScanProgress,
  getWaybackVersions,
  probeWaybackMaxZoom,
  scanWaybackMetadata,
} from './wayback-api'
import type {
  DownloadEstimate,
  DownloadRequest,
  WaybackReleaseSummary,
  WaybackVersion,
} from '@/types/api'

type WbMode = 'single' | 'batch' | 'incremental'

const FORMAT_OPTIONS = [
  { value: 'geotiff', label: 'GeoTIFF (.tif)' },
  { value: 'png', label: 'PNG (.png)' },
  { value: 'jpeg', label: 'JPEG (.jpg)' },
]

const COMPRESSION_OPTIONS = [
  { value: 'lzw', label: 'LZW (推荐)' },
  { value: 'deflate', label: 'Deflate' },
  { value: 'none', label: '无压缩' },
]

function extOf(format: string) {
  return format === 'geotiff' ? 'tif' : format === 'png' ? 'png' : 'jpg'
}

function formatZoomLabel(zoom: number, zoomMax: number | null) {
  if (zoomMax && zoomMax > zoom) return `z${zoom}-${zoomMax}`
  return `z${zoom}`
}

function timestampNow() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

export function WaybackPage() {
  const inTauri = isTauriRuntime()
  const qc = useQueryClient()

  const bounds = useSelectionStore((s) => s.bounds)
  const polygon = useSelectionStore((s) => s.polygon)
  const setPreviewVersionId = useWaybackStore((s) => s.setPreviewVersionId)
  const previewVersionId = useWaybackStore((s) => s.previewVersionId)

  const [wbMode, setWbMode] = useState<WbMode>('single')
  const [versionId, setVersionId] = useState<string>('')
  const [zoom, setZoom] = useState<number>(13)
  const [zoomMax, setZoomMax] = useState<number | ''>('')
  const [format, setFormat] = useState<string>('geotiff')
  const [compression, setCompression] = useState<string>('lzw')
  const [cropToShape, setCropToShape] = useState<boolean>(false)
  const [concurrency, setConcurrency] = useState<number>(8)
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())
  const [scanMode, setScanMode] = useState<'fast' | 'fine'>('fast')
  const [coverageThreshold, setCoverageThreshold] = useState<number>(5)
  const [dominantThreshold, setDominantThreshold] = useState<number>(50)
  const [onlyLatestPerYear, setOnlyLatestPerYear] = useState<boolean>(false)
  const [scanReleases, setScanReleases] = useState<WaybackReleaseSummary[]>([])
  const [scanReleasesScanned, setScanReleasesScanned] = useState<number>(0)
  const [scanProgress, setScanProgress] = useState<{
    current: number
    total: number
    footprints: number
    elapsed: number
  } | null>(null)
  const [estimate, setEstimate] = useState<DownloadEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [incSelected, setIncSelected] = useState<Set<string>>(new Set())
  const scanAbortRef = useRef(false)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: inTauri,
  })
  const proxy =
    settingsQuery.data?.proxy_enabled && settingsQuery.data.proxy_url
      ? settingsQuery.data.proxy_url
      : null

  const versionsQuery = useQuery({
    queryKey: ['wayback-versions', proxy ?? ''],
    queryFn: () => getWaybackVersions(proxy),
    enabled: inTauri,
    staleTime: 5 * 60_000,
  })

  // 默认选第一个版本
  useEffect(() => {
    const list = versionsQuery.data
    if (list && list.length > 0 && !versionId) {
      setVersionId(list[0].id)
    }
  }, [versionsQuery.data, versionId])

  // 同步 Wayback 预览图层（仅在单/批模式下展示当前选中版本）
  useEffect(() => {
    if (wbMode === 'incremental') {
      setPreviewVersionId(null)
      return
    }
    setPreviewVersionId(versionId || null)
  }, [versionId, wbMode, setPreviewVersionId])

  // 时间轴 → 侧栏：当外部（时间轴）改变 previewVersionId 时同步 select
  useEffect(() => {
    if (wbMode === 'incremental') return
    if (previewVersionId && previewVersionId !== versionId) {
      setVersionId(previewVersionId)
    }
  }, [previewVersionId, wbMode, versionId])

  // 离开页面时移除 wayback 预览
  useEffect(() => {
    return () => setPreviewVersionId(null)
  }, [setPreviewVersionId])

  const sortedVersions: WaybackVersion[] = useMemo(
    () => versionsQuery.data ?? [],
    [versionsQuery.data],
  )

  const selectedVersion = sortedVersions.find((v) => v.id === versionId) ?? null

  const probeMutation = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error('请先选择版本')
      // 取选区中心点
      const b = bounds
      let lat = 39.9
      let lng = 116.4
      if (b) {
        lat = (b.north + b.south) / 2
        lng = (b.east + b.west) / 2
      }
      return probeWaybackMaxZoom(versionId, lat, lng, proxy)
    },
    onSuccess: (z) => {
      setZoom(z)
      toast.success(`最大缩放 z${z}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`探测失败：${msg}`)
    },
  })

  // 自动估算：单版本模式下，参数变化后 400ms 防抖触发，结果显示在缩放下方
  useEffect(() => {
    if (wbMode !== 'single') return
    if (!bounds) {
      setEstimate(null)
      return
    }
    const zMax = typeof zoomMax === 'number' && zoomMax > zoom ? zoomMax : null
    const t = window.setTimeout(() => {
      setEstimating(true)
      estimateDownload(bounds, zoom, format, cropToShape, zMax)
        .then((res) => setEstimate(res))
        .catch(() => setEstimate(null))
        .finally(() => setEstimating(false))
    }, 400)
    return () => window.clearTimeout(t)
  }, [wbMode, bounds, zoom, zoomMax, format, cropToShape])

  // ========== 单个下载 ==========
  const singleMutation = useMutation({
    mutationFn: async () => {
      if (!versionId || !selectedVersion) throw new Error('请先选择版本')
      if (!bounds) throw new Error('请先选择下载区域')

      const ext = extOf(format)
      const zLabel = formatZoomLabel(zoom, typeof zoomMax === 'number' ? zoomMax : null)
      const defaultName = `wayback_${selectedVersion.date}_${zLabel}_${timestampNow()}.${ext}`

      const savePath = await saveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Image', extensions: [ext] }],
      })
      if (!savePath) throw new Error('__user_cancelled__')

      const zMax = typeof zoomMax === 'number' && zoomMax > zoom ? zoomMax : null
      const request: DownloadRequest = {
        bounds,
        zoom,
        zoom_max: zMax,
        source: 'esri_wayback',
        format,
        save_path: savePath as string,
        concurrency,
        proxy,
        polygon: cropToShape && polygon ? polygon : null,
        crop_to_shape: cropToShape && polygon != null,
        tianditu_token: null,
        compression: format === 'geotiff' ? compression : 'none',
        build_pyramid: false,
      }
      const taskName = `Wayback ${selectedVersion.date} ${zLabel}`
      return createWaybackTask(request, versionId, selectedVersion.date, taskName)
    },
    onSuccess: () => {
      toast.success('Wayback 下载任务已创建')
      useAppStore.getState().setTab('history')
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__user_cancelled__') return
      toast.error(`下载失败：${msg}`)
    },
  })

  // ========== 批量下载 ==========
  const batchMutation = useMutation({
    mutationFn: async () => {
      if (!bounds) throw new Error('请先选择下载区域')
      if (batchSelected.size === 0) throw new Error('请至少选择一个版本')
      const dir = await openDialog({
        directory: true,
        title: '选择批量下载保存目录',
      })
      if (!dir) throw new Error('__user_cancelled__')

      const zMax = typeof zoomMax === 'number' && zoomMax > zoom ? zoomMax : null
      const zLabel = formatZoomLabel(zoom, zMax)
      const ext = extOf(format)
      const versions = sortedVersions.filter((v) => batchSelected.has(v.id))

      let created = 0
      for (const v of versions) {
        const filename = `wayback_${v.date}_${zLabel}_${timestampNow()}.${ext}`
        const sep = (dir as string).includes('\\') ? '\\' : '/'
        const savePath = `${dir}${sep}${filename}`
        const request: DownloadRequest = {
          bounds,
          zoom,
          zoom_max: zMax,
          source: 'esri_wayback',
          format,
          save_path: savePath,
          concurrency,
          proxy,
          polygon: cropToShape && polygon ? polygon : null,
          crop_to_shape: cropToShape && polygon != null,
          tianditu_token: null,
          compression: format === 'geotiff' ? compression : 'none',
          build_pyramid: false,
        }
        try {
          await createWaybackTask(request, v.id, v.date, `Wayback ${v.date} ${zLabel}`)
          created += 1
        } catch (e) {
          console.error(`批量任务 ${v.date} 创建失败:`, e)
        }
      }
      return created
    },
    onSuccess: (n) => {
      toast.success(`已创建 ${n} 个批量任务`)
      useAppStore.getState().setTab('history')
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__user_cancelled__') return
      toast.error(`批量下载失败：${msg}`)
    },
  })

  // ========== 增量扫描 ==========
  const scanMutation = useMutation({
    mutationFn: async () => {
      if (!bounds) throw new Error('请先选择下载区域')
      const zMin = Math.max(zoom - 1, 1)
      const zMaxScan = Math.min(zoom + 1, 22)
      const bbox: [number, number, number, number] = [
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north,
      ]
      scanAbortRef.current = false
      setScanReleases([])
      setIncSelected(new Set())
      setScanProgress(null)

      const res = await scanWaybackMetadata({
        bbox,
        zoom_min: zMin,
        zoom_max: zMaxScan,
        force_refresh: false,
        proxy,
        scan_mode: scanMode,
      })

      if (res.kind === 'result') {
        return res
      }

      // 后台扫描中，轮询进度
      const scanId = res.scan_id
      const total = res.total
      while (!scanAbortRef.current) {
        await new Promise((r) => setTimeout(r, 1500))
        const prog = await getWaybackScanProgress(scanId).catch(() => null)
        if (!prog) {
          // 扫描完成 → 重新查缓存
          const final = await scanWaybackMetadata({
            bbox,
            zoom_min: zMin,
            zoom_max: zMaxScan,
            force_refresh: false,
            proxy,
            scan_mode: scanMode,
          })
          if (final.kind === 'result') return final
          throw new Error('扫描完成但未取得结果')
        }
        setScanProgress({
          current: prog.current,
          total,
          footprints: prog.footprints_so_far,
          elapsed: prog.elapsed_sec,
        })
      }
      throw new Error('__user_cancelled__')
    },
    onSuccess: (res) => {
      if (res.kind !== 'result') return
      setScanReleases(res.releases ?? [])
      setScanReleasesScanned(res.releases_scanned ?? 0)
      setScanProgress(null)
      toast.success(`扫描完成：${res.releases.length} 个 release`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__user_cancelled__') return
      toast.error(`扫描失败：${msg}`)
      setScanProgress(null)
    },
  })

  // 增量结果过滤
  const filteredReleases: WaybackReleaseSummary[] = useMemo(() => {
    const cov = coverageThreshold / 100
    const dom = dominantThreshold / 100
    let items = scanReleases.filter(
      (r) =>
        (r.coverage_ratio ?? 0) >= cov &&
        (r.dominant_ratio ?? 0) >= dom &&
        r.dominant_capture_date,
    )
    if (onlyLatestPerYear) {
      const seen = new Map<string, WaybackReleaseSummary>()
      for (const r of items) {
        const year = r.dominant_capture_date.slice(0, 4)
        const prev = seen.get(year)
        if (!prev || (r.release_num ?? 0) > (prev.release_num ?? 0)) {
          seen.set(year, r)
        }
      }
      items = Array.from(seen.values()).sort(
        (a, b) => (b.release_num ?? 0) - (a.release_num ?? 0),
      )
    }
    return items
  }, [scanReleases, coverageThreshold, dominantThreshold, onlyLatestPerYear])

  // 选中默认全选
  useEffect(() => {
    setIncSelected(new Set(filteredReleases.map((r) => r.release_id)))
  }, [filteredReleases])

  const incDownloadMutation = useMutation({
    mutationFn: async () => {
      if (!bounds) throw new Error('请先选择下载区域')
      if (incSelected.size === 0) throw new Error('请至少选择一个 release')
      const dir = await openDialog({ directory: true, title: '选择保存目录' })
      if (!dir) throw new Error('__user_cancelled__')

      const ext = extOf(format)
      const sep = (dir as string).includes('\\') ? '\\' : '/'
      const savePathBase = `${dir}${sep}wayback_inc.${ext}`
      const zMax = typeof zoomMax === 'number' && zoomMax > zoom ? zoomMax : null
      const footprints = filteredReleases
        .filter((r) => incSelected.has(r.release_id))
        .map((r) => ({
          release_id: r.release_id,
          release_date: r.release_date,
          capture_date_str: r.dominant_capture_date,
          source_name: r.source_name,
          resolution_m: r.resolution_m,
        }))
      const result = await downloadWaybackIncremental({
        bounds,
        zoom,
        zoom_max: zMax,
        format,
        save_path: savePathBase,
        footprints,
        crop_to_shape: cropToShape && polygon != null,
        polygon: cropToShape && polygon ? polygon[0] : null,
        compression: format === 'geotiff' ? compression : 'none',
        build_pyramid: false,
        proxy,
      })
      return result.task_ids.length
    },
    onSuccess: (n) => {
      toast.success(`已创建 ${n} 个增量下载任务`)
      useAppStore.getState().setTab('history')
      qc.invalidateQueries({ queryKey: ['active-tasks'] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__user_cancelled__') return
      toast.error(`下载失败：${msg}`)
    },
  })

  return (
    <div className="space-y-4">
      <RegionSelector />

      <PanelSection
        icon={History}
        title="Esri Wayback 历史影像"
        description="按时间轴访问 Esri 全球历史影像"
        action={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            title="刷新版本列表"
            onClick={() => versionsQuery.refetch()}
            disabled={versionsQuery.isFetching}
          >
            {versionsQuery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        }
      >
        {/* 版本下拉 */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            影像日期
          </Label>
          <Select value={versionId} onValueChange={setVersionId}>
            <SelectTrigger>
              <SelectValue placeholder={versionsQuery.isLoading ? '加载中...' : '选择日期'} />
            </SelectTrigger>
            <SelectContent>
              {sortedVersions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.date}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 缩放 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">缩放级别 z{zoom}</Label>
            <div className="flex items-center gap-2">
              <Slider
                min={1}
                max={22}
                step={1}
                value={[zoom]}
                onValueChange={(v) => setZoom(v[0] ?? zoom)}
                className="flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => probeMutation.mutate()}
                disabled={probeMutation.isPending}
              >
                {probeMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Search className="size-3" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">最大缩放（可选）</Label>
            <Input
              type="number"
              min={zoom}
              max={22}
              value={zoomMax}
              onChange={(e) => {
                const v = e.target.value
                setZoomMax(v === '' ? '' : Math.max(zoom, Math.min(22, Number(v))))
              }}
              placeholder="留空=单层"
              className="h-8 text-xs"
            />
          </div>
        </div>

        {/* 自动估算结果 */}
        {wbMode === 'single' && bounds && (
          <StatCard variant="compact">
            {estimating ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                估算中…
              </span>
            ) : estimate ? (
              <>
                预计下载{' '}
                <strong>{estimate.tile_count.toLocaleString()}</strong> 个瓦片 · 约{' '}
                <strong>{estimate.estimated_size_mb?.toFixed(1) ?? '?'}</strong> MB
                {estimate.warning && (
                  <div className="mt-1 text-amber-600 dark:text-amber-400">
                    {estimate.warning}
                  </div>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">等待估算…</span>
            )}
          </StatCard>
        )}

        {/* 格式 + 压缩 + 并发 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">输出格式</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {format === 'geotiff' && (
            <div className="space-y-1.5">
              <Label className="text-xs">TIFF 压缩</Label>
              <Select value={compression} onValueChange={setCompression}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPRESSION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">下载并发：{concurrency}</Label>
          <Slider
            min={1}
            max={32}
            step={1}
            value={[concurrency]}
            onValueChange={(v) => setConcurrency(v[0] ?? concurrency)}
          />
        </div>

        {polygon && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={cropToShape}
              onChange={(e) => setCropToShape(e.target.checked)}
              className="size-3.5"
            />
            按多边形精确裁剪
          </label>
        )}

        <Separator />

        <Tabs value={wbMode} onValueChange={(v) => setWbMode(v as WbMode)}>
          <TabsList className="grid h-8 w-full grid-cols-3">
            <TabsTrigger value="single" className="text-xs">单个</TabsTrigger>
            <TabsTrigger value="batch" className="text-xs">批量</TabsTrigger>
            <TabsTrigger value="incremental" className="text-xs">增量</TabsTrigger>
          </TabsList>

          {/* 单个下载 */}
          <TabsContent value="single" className="mt-3 space-y-2">
            <Button
              type="button"
              size="sm"
              onClick={() => singleMutation.mutate()}
              disabled={singleMutation.isPending || !bounds || !versionId}
            >
              {singleMutation.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 size-3.5" />
              )}
              下载历史影像
            </Button>
          </TabsContent>

          {/* 批量下载 */}
          <TabsContent value="batch" className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setBatchSelected(new Set(sortedVersions.map((v) => v.id)))}
              >
                全选
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setBatchSelected(new Set())}
              >
                清空
              </Button>
              <span className="ml-auto text-muted-foreground">已选 {batchSelected.size}</span>
            </div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border bg-background/50 p-2 text-xs">
              {sortedVersions.map((v) => (
                <label key={v.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={batchSelected.has(v.id)}
                    onChange={(e) => {
                      const next = new Set(batchSelected)
                      if (e.target.checked) next.add(v.id)
                      else next.delete(v.id)
                      setBatchSelected(next)
                    }}
                    className="size-3.5"
                  />
                  <span>{v.date}</span>
                  <span className="truncate text-muted-foreground">{v.title}</span>
                </label>
              ))}
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() => batchMutation.mutate()}
              disabled={batchMutation.isPending || batchSelected.size === 0 || !bounds}
            >
              {batchMutation.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 size-3.5" />
              )}
              批量下载选中版本
            </Button>
          </TabsContent>

          {/* 增量下载 */}
          <TabsContent value="incremental" className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Label className="text-xs">扫描模式</Label>
              <Select value={scanMode} onValueChange={(v) => setScanMode(v as 'fast' | 'fine')}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">fast</SelectItem>
                  <SelectItem value="fine">fine</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending || !bounds}
              >
                {scanMutation.isPending ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Search className="mr-1 size-3" />
                )}
                {scanReleases.length > 0 ? '重新扫描' : '扫描影像清单'}
              </Button>
            </div>

            {scanProgress && (
              <div className="space-y-1 rounded border bg-muted/20 p-2 text-xs">
                <div className="flex justify-between">
                  <span>
                    {scanProgress.current} / {scanProgress.total}
                  </span>
                  <span>{scanProgress.elapsed}s</span>
                </div>
                <div className="h-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${
                        scanProgress.total > 0
                          ? Math.round((scanProgress.current / scanProgress.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="text-muted-foreground">
                  已发现 {scanProgress.footprints} 个 footprint
                </div>
              </div>
            )}

            {scanReleases.length > 0 && (
              <>
                <div className="rounded border bg-muted/20 p-2 text-xs">
                  扫描了 <strong>{scanReleasesScanned}</strong> 个 release，区域内有数据{' '}
                  <strong>{scanReleases.length}</strong> 个
                </div>

                <div className="space-y-1.5 rounded border bg-background/50 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Label className="w-20 text-xs">覆盖率 ≥</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={coverageThreshold}
                      onChange={(e) => setCoverageThreshold(Number(e.target.value))}
                      className="h-7 w-16 text-xs"
                    />
                    <span>%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="w-20 text-xs">主导日期 ≥</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={dominantThreshold}
                      onChange={(e) => setDominantThreshold(Number(e.target.value))}
                      className="h-7 w-16 text-xs"
                    />
                    <span>%</span>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onlyLatestPerYear}
                      onChange={(e) => setOnlyLatestPerYear(e.target.checked)}
                      className="size-3.5"
                    />
                    每年只保留最新 release
                  </label>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setIncSelected(new Set(filteredReleases.map((r) => r.release_id)))
                    }
                  >
                    全选
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setIncSelected(new Set())}
                  >
                    清空
                  </Button>
                  <span className="ml-auto text-muted-foreground">
                    {filteredReleases.length} 个 release · 已选 {incSelected.size}
                  </span>
                </div>

                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded border bg-background/50 p-2 text-xs">
                  {filteredReleases.length === 0 ? (
                    <div className="py-3 text-center text-muted-foreground">无符合条件的 release</div>
                  ) : (
                    filteredReleases.map((r) => {
                      const cov = Math.round((r.coverage_ratio ?? 0) * 100)
                      const dom = Math.round((r.dominant_ratio ?? 0) * 100)
                      const dotColor = (r.source_name ?? '').includes('Vivid')
                        ? '#4caf50'
                        : (r.source_name ?? '').includes('Maxar')
                          ? '#2196f3'
                          : '#9e9e9e'
                      return (
                        <label key={r.release_id} className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={incSelected.has(r.release_id)}
                            onChange={(e) => {
                              const next = new Set(incSelected)
                              if (e.target.checked) next.add(r.release_id)
                              else next.delete(r.release_id)
                              setIncSelected(next)
                            }}
                            className="mt-0.5 size-3.5"
                          />
                          <span
                            className="mt-1 inline-block size-2 shrink-0 rounded-full"
                            style={{ background: dotColor }}
                          />
                          <span className="flex-1">
                            <span className="font-medium">{r.dominant_capture_date}</span>
                            <span className="text-muted-foreground">
                              {' · '}
                              {r.source_name || '未知源'} ·{' '}
                              {r.resolution_m > 0 ? `${r.resolution_m.toFixed(2)}m` : '?'}
                            </span>
                            <div className="text-muted-foreground">
                              release {r.release_date} · 主导 {dom}%
                              {r.captures.length > 1 && ` · 共 ${r.captures.length} 个日期`}
                            </div>
                          </span>
                          <span className="shrink-0 text-muted-foreground">覆盖 {cov}%</span>
                        </label>
                      )
                    })
                  )}
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => incDownloadMutation.mutate()}
                  disabled={
                    incDownloadMutation.isPending || incSelected.size === 0 || !bounds
                  }
                >
                  {incDownloadMutation.isPending ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 size-3.5" />
                  )}
                  下载选中的 release
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PanelSection>
    </div>
  )
}
