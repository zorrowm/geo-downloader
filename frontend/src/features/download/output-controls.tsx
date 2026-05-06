import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Bounds, Polygon } from '@/types/api'

import { selectionCropLabel } from './crop-utils'

export type TiffCompression = 'none' | 'lzw' | 'deflate'

export const TIFF_COMPRESSION_OPTIONS: { value: TiffCompression; label: string }[] = [
  { value: 'none', label: '无压缩 (最快导出)' },
  { value: 'lzw', label: 'LZW (通用兼容)' },
  { value: 'deflate', label: 'Deflate (体积最小)' },
]

export function TiffCompressionSelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: TiffCompression
  onChange: (value: TiffCompression) => void
  triggerClassName?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">TIFF 压缩</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TiffCompression)}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIFF_COMPRESSION_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BuildPyramidToggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  return (
    <label className={cn('flex items-center gap-2 text-xs', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5"
      />
      构建影像金字塔（加速 GIS 浏览）
    </label>
  )
}

export function SelectionCropToggle({
  bounds,
  polygon,
  checked,
  onChange,
  className,
}: {
  bounds: Bounds | null | undefined
  polygon: Polygon | null | undefined
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  if (!bounds) return null

  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-primary"
      />
      <span>
        {selectionCropLabel(polygon)}
        <span className="ml-1 text-muted-foreground">默认开启，框外透明</span>
      </span>
    </label>
  )
}