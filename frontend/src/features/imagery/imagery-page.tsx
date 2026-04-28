import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Calculator, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { createDownloadTask, estimateDownload } from '@/features/download/download-api'
import { MapPicker, type MapPickerValue } from '@/features/imagery/map-picker'
import { getSettings } from '@/features/settings/settings-api'
import { getTileSourcesMerged } from '@/features/sources/sources-api'
import type { DownloadEstimate, DownloadRequest, OutputFormat } from '@/types/api'

const FORMAT_OPTIONS = [
  { value: 'geotiff', label: 'GeoTIFF (.tif)' },
  { value: 'tiles', label: '原始瓦片目录' },
  { value: 'mbtiles', label: 'MBTiles (.mbtiles)' },
  { value: 'gpkg', label: 'GeoPackage (.gpkg)' },
] as const

const downloadSchema = z
  .object({
    north: z.number(),
    south: z.number(),
    east: z.number(),
    west: z.number(),
    source: z.string().min(1, '请选择图源'),
    zoom: z.number().int().min(0).max(22),
    zoom_max_enabled: z.boolean(),
    zoom_max: z.number().int().min(0).max(22),
    format: z.enum(['geotiff', 'tiles', 'mbtiles', 'gpkg']),
    concurrency: z.number().int().min(1).max(100),
    save_path: z.string().min(1, '请填写保存路径'),
    task_name: z.string().min(1, '请填写任务名称'),
  })
  .refine((v) => v.north > v.south, {
    message: '北纬必须大于南纬',
    path: ['north'],
  })
  .refine((v) => v.east > v.west, {
    message: '东经必须大于西经',
    path: ['east'],
  })
  .refine((v) => !v.zoom_max_enabled || v.zoom_max >= v.zoom, {
    message: '最大缩放必须 ≥ 起始缩放',
    path: ['zoom_max'],
  })

type DownloadFormValues = z.infer<typeof downloadSchema>

const DEFAULT_VALUES: DownloadFormValues = {
  north: 39.99,
  south: 39.85,
  east: 116.5,
  west: 116.3,
  source: '',
  zoom: 12,
  zoom_max_enabled: false,
  zoom_max: 14,
  format: 'geotiff',
  concurrency: 30,
  save_path: '',
  task_name: '',
}

function formatBytes(mb?: number | null): string {
  if (mb == null || !Number.isFinite(mb)) return '-'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(2)} MB`
}

export function ImageryPage() {
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })
  const tiandituToken = settingsQuery.data?.tianditu_token ?? null
  const sourcesQuery = useQuery({
    queryKey: ['tile-sources-merged', tiandituToken],
    queryFn: () => getTileSourcesMerged(tiandituToken),
  })

  const sourceList = useMemo(
    () =>
      Object.values(sourcesQuery.data ?? {}).sort((a, b) =>
        (a.name || '').localeCompare(b.name || ''),
      ),
    [sourcesQuery.data],
  )

  const form = useForm<DownloadFormValues>({
    resolver: zodResolver(downloadSchema),
    defaultValues: DEFAULT_VALUES,
  })
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = form

  // 当 settings/sources 加载完成，把默认值注入表单（渲染期同步，避免 set-state-in-effect）
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  if (!defaultsApplied && settingsQuery.data && sourcesQuery.data) {
    const s = settingsQuery.data
    const firstSourceId =
      (s.default_source && sourcesQuery.data[s.default_source] && s.default_source) ||
      sourceList[0]?.id ||
      sourceList[0]?.key ||
      ''
    setValue('source', firstSourceId ?? '')
    if (typeof s.default_concurrency === 'number') setValue('concurrency', s.default_concurrency)
    if (typeof s.default_zoom === 'number') setValue('zoom', s.default_zoom)
    const fmt = (s.default_format ?? 'geotiff') as OutputFormat
    if (['geotiff', 'tiles', 'mbtiles', 'gpkg'].includes(fmt as string)) {
      setValue('format', fmt as DownloadFormValues['format'])
    }
    setDefaultsApplied(true)
  }

  const source = useWatch({ control, name: 'source' })
  const format = useWatch({ control, name: 'format' })
  const zoomMaxEnabled = useWatch({ control, name: 'zoom_max_enabled' })
  const north = useWatch({ control, name: 'north' })
  const south = useWatch({ control, name: 'south' })
  const east = useWatch({ control, name: 'east' })
  const west = useWatch({ control, name: 'west' })

  const [estimate, setEstimate] = useState<DownloadEstimate | null>(null)
  const [polygon, setPolygon] = useState<MapPickerValue['polygon']>(null)
  const [cropToShape, setCropToShape] = useState(false)

  const handleMapChange = (v: MapPickerValue) => {
    if (v.bounds) {
      setValue('north', Number(v.bounds.north.toFixed(6)), { shouldValidate: true })
      setValue('south', Number(v.bounds.south.toFixed(6)), { shouldValidate: true })
      setValue('east', Number(v.bounds.east.toFixed(6)), { shouldValidate: true })
      setValue('west', Number(v.bounds.west.toFixed(6)), { shouldValidate: true })
    }
    setPolygon(v.polygon)
    if (!v.polygon) setCropToShape(false)
  }

  const estimateMutation = useMutation({
    mutationFn: (values: DownloadFormValues) =>
      estimateDownload(
        { north: values.north, south: values.south, east: values.east, west: values.west },
        values.zoom,
        values.format,
        cropToShape && polygon != null,
        values.zoom_max_enabled ? values.zoom_max : null,
      ),
    onSuccess: (data) => {
      setEstimate(data)
      if (data.warning) toast.warning(data.warning)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`估算失败：${msg}`)
    },
  })

  const submitMutation = useMutation({
    mutationFn: (values: DownloadFormValues) => {
      const sourceMeta = sourcesQuery.data?.[values.source]
      const request: DownloadRequest = {
        bounds: {
          north: values.north,
          south: values.south,
          east: values.east,
          west: values.west,
        },
        zoom: values.zoom,
        zoom_max: values.zoom_max_enabled ? values.zoom_max : null,
        source: values.source,
        format: values.format,
        save_path: values.save_path,
        concurrency: values.concurrency,
        tianditu_token: settingsQuery.data?.tianditu_token ?? null,
        proxy:
          settingsQuery.data?.proxy_enabled && settingsQuery.data.proxy_url
            ? settingsQuery.data.proxy_url
            : null,
        crop_to_shape: cropToShape && polygon != null,
        polygon: cropToShape && polygon ? polygon : null,
      }
      return createDownloadTask(
        request,
        values.task_name,
        sourceMeta?.name ?? values.source,
      )
    },
    onSuccess: (res) => {
      toast.success(`任务已创建，ID: ${res.task_id.slice(0, 8)}...，瓦片数 ${res.tile_count}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`创建任务失败：${msg}`)
    },
  })

  const onEstimate = handleSubmit((v) => estimateMutation.mutate(v))
  const onSubmit = handleSubmit((v) => submitMutation.mutate(v))

  const sourcesLoading = sourcesQuery.isLoading || settingsQuery.isLoading

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>影像下载</CardTitle>
          <CardDescription>
            在地图上绘制矩形/多边形或导入 Shapefile 来选取范围；也可以直接编辑下方经纬度数字框。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">选区</h3>
              <MapPicker
                value={{
                  bounds:
                    Number.isFinite(north) && Number.isFinite(south)
                      ? { north, south, east, west }
                      : null,
                  polygon,
                }}
                onChange={handleMapChange}
              />
              {polygon && (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cropToShape}
                    onChange={(e) => setCropToShape(e.target.checked)}
                    className="size-4"
                  />
                  按多边形精确裁剪（crop_to_shape）
                </label>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">范围（经纬度，WGS-84）</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="north">北 (north)</Label>
                  <Input
                    id="north"
                    type="number"
                    step="0.0001"
                    {...register('north', { valueAsNumber: true })}
                  />
                  {errors.north && (
                    <p className="text-xs text-destructive">{errors.north.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="south">南 (south)</Label>
                  <Input
                    id="south"
                    type="number"
                    step="0.0001"
                    {...register('south', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="west">西 (west)</Label>
                  <Input
                    id="west"
                    type="number"
                    step="0.0001"
                    {...register('west', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="east">东 (east)</Label>
                  <Input
                    id="east"
                    type="number"
                    step="0.0001"
                    {...register('east', { valueAsNumber: true })}
                  />
                  {errors.east && (
                    <p className="text-xs text-destructive">{errors.east.message}</p>
                  )}
                </div>
              </div>
            </section>

            <Separator />

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>图源</Label>
                <Select
                  value={source}
                  onValueChange={(v) => setValue('source', v, { shouldValidate: true })}
                  disabled={sourcesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={sourcesLoading ? '加载中...' : '请选择'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceList.map((s) => {
                      const id = s.id ?? s.key ?? ''
                      return (
                        <SelectItem key={id} value={id}>
                          {s.name}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {errors.source && (
                  <p className="text-xs text-destructive">{errors.source.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>输出格式</Label>
                <Select
                  value={format}
                  onValueChange={(v) =>
                    setValue('format', v as DownloadFormValues['format'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="zoom">起始缩放级别</Label>
                <Input
                  id="zoom"
                  type="number"
                  min={0}
                  max={22}
                  {...register('zoom', { valueAsNumber: true })}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="zoom_max">最大缩放级别</Label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      {...register('zoom_max_enabled')}
                      className="size-3"
                    />
                    启用多级
                  </label>
                </div>
                <Input
                  id="zoom_max"
                  type="number"
                  min={0}
                  max={22}
                  disabled={!zoomMaxEnabled}
                  {...register('zoom_max', { valueAsNumber: true })}
                />
                {errors.zoom_max && (
                  <p className="text-xs text-destructive">{errors.zoom_max.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="concurrency">并发数 (1-100)</Label>
                <Input
                  id="concurrency"
                  type="number"
                  min={1}
                  max={100}
                  {...register('concurrency', { valueAsNumber: true })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task_name">任务名称</Label>
                <Input
                  id="task_name"
                  placeholder="例如 北京三环影像 z12"
                  {...register('task_name')}
                />
                {errors.task_name && (
                  <p className="text-xs text-destructive">{errors.task_name.message}</p>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="save_path">保存路径</Label>
                <Input
                  id="save_path"
                  placeholder="C:\Downloads\beijing.tif（绝对路径，必填）"
                  className="font-mono text-xs"
                  {...register('save_path')}
                />
                {errors.save_path && (
                  <p className="text-xs text-destructive">{errors.save_path.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  S4a 阶段需手动填写完整路径；目录选择器将在后续切片接入。
                </p>
              </div>
            </section>

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onEstimate}
                disabled={estimateMutation.isPending || sourcesLoading}
              >
                {estimateMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Calculator className="mr-2 size-4" />
                )}
                估算
              </Button>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={submitMutation.isPending || sourcesLoading}
              >
                {submitMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                创建下载任务
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {estimate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">估算结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                瓦片数：<Badge variant="secondary">{estimate.tile_count.toLocaleString()}</Badge>
              </div>
              <div>
                网格：{estimate.cols ?? '-'} × {estimate.rows ?? '-'}
              </div>
              <div>预估大小：{formatBytes(estimate.estimated_size_mb)}</div>
              {estimate.raw_size_mb != null && (
                <div>原始未压缩：{formatBytes(estimate.raw_size_mb)}</div>
              )}
            </div>
            {estimate.size_note && (
              <p className="text-xs text-muted-foreground">{estimate.size_note}</p>
            )}
            {estimate.warning && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{estimate.warning}</span>
              </div>
            )}
            {estimate.budget_check && estimate.budget_check.allowed === false && (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{estimate.budget_check.message ?? '内存预算不足'}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
