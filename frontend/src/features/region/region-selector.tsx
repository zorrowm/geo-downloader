import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import shp from 'shpjs'
import { Loader2, MapPin, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'

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
import { isTauriRuntime } from '@/lib/tauri'
import {
  geocodeSearch,
  getAdminBoundary,
  getCities,
  getDistricts,
  getProvinces,
  type GeocodeResult,
} from './region-api'
import { useSelectionStore, type LatLngRing, type MapBounds } from '@/store/selection-store'
import { useAppStore } from '@/store/app-store'
import { useBatchStore } from '@/store/batch-store'
import { getSettings } from '@/features/settings/settings-api'

function ringsFromGeoJSON(geojson: GeoJsonObject): LatLngRing[] {
  const rings: LatLngRing[] = []
  const handle = (geom: Feature['geometry'] | null | undefined) => {
    if (!geom) return
    if (geom.type === 'Polygon') {
      rings.push(geom.coordinates[0].map((c) => ({ lat: c[1], lng: c[0] })))
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        rings.push(poly[0].map((c) => ({ lat: c[1], lng: c[0] })))
      }
    }
  }
  const obj = geojson as FeatureCollection | Feature | GeoJsonObject
  if ((obj as FeatureCollection).type === 'FeatureCollection') {
    for (const f of (obj as FeatureCollection).features) handle(f.geometry)
  } else if ((obj as Feature).type === 'Feature') {
    handle((obj as Feature).geometry)
  } else {
    handle(geojson as Feature['geometry'])
  }
  return rings
}

function boundsFromRings(rings: LatLngRing[]): MapBounds | null {
  if (rings.length === 0) return null
  let n = -Infinity
  let s = Infinity
  let e = -Infinity
  let w = Infinity
  for (const ring of rings) {
    for (const p of ring) {
      if (p.lat > n) n = p.lat
      if (p.lat < s) s = p.lat
      if (p.lng > e) e = p.lng
      if (p.lng < w) w = p.lng
    }
  }
  return { north: n, south: s, east: e, west: w }
}

export function RegionSelector() {
  const inTauri = isTauriRuntime()
  const setExternalSelection = useSelectionStore((s) => s.setExternalSelection)
  const setCurrentAdminCode = useAppStore((s) => s.setCurrentAdminCode)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)

  const [provinceCode, setProvinceCode] = useState<string>('')
  const [cityCode, setCityCode] = useState<string>('')
  const [districtCode, setDistrictCode] = useState<string>('')
  const [loadingBoundary, setLoadingBoundary] = useState(false)

  // 选中的行政区代码（街道/区县/市/省，按从细到粗的优先级）→ 同步到 store
  useEffect(() => {
    const code = districtCode || cityCode || provinceCode || null
    setCurrentAdminCode(code)
  }, [provinceCode, cityCode, districtCode, setCurrentAdminCode])

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: inTauri })

  const provincesQuery = useQuery({
    queryKey: ['admin-provinces'],
    queryFn: getProvinces,
    enabled: inTauri,
  })
  const citiesQuery = useQuery({
    queryKey: ['admin-cities', provinceCode],
    queryFn: () => getCities(provinceCode),
    enabled: inTauri && !!provinceCode,
  })
  const districtsQuery = useQuery({
    queryKey: ['admin-districts', cityCode],
    queryFn: () => getDistricts(cityCode),
    enabled: inTauri && !!cityCode,
  })

  const fileRef = useRef<HTMLInputElement>(null)

  const loadByCode = async (code: string, label: string) => {
    if (!code) return
    setLoadingBoundary(true)
    try {
      const geojson = (await getAdminBoundary(code, true)) as GeoJsonObject
      const rings = ringsFromGeoJSON(geojson)
      if (rings.length === 0) {
        toast.error('未能从行政边界中提取多边形')
        return
      }
      setExternalSelection({ bounds: boundsFromRings(rings), polygon: rings })
      setCurrentAdminCode(code)
      toast.success(`已加载 ${label}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`加载边界失败：${msg}`)
    } finally {
      setLoadingBoundary(false)
    }
  }

  const onLoadSelectedBoundary = () => {
    const code = districtCode || cityCode || provinceCode
    if (!code) {
      toast.warning('请先选择行政区划')
      return
    }
    const label =
      districtsQuery.data?.find((d) => d.code === districtCode)?.name ||
      citiesQuery.data?.find((c) => c.code === cityCode)?.name ||
      provincesQuery.data?.find((p) => p.code === provinceCode)?.name ||
      code
    void loadByCode(code, label)
  }

  const onSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const token = settingsQuery.data?.tianditu_token ?? null
      const results = await geocodeSearch(q, token)
      setSearchResults(results)
      if (results.length === 0) toast.info('未找到结果')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`搜索失败：${msg}`)
    } finally {
      setSearching(false)
    }
  }

  const onPickResult = (r: GeocodeResult) => {
    if (r.kind === 'admin' && r.admin_code) {
      void loadByCode(r.admin_code, r.name)
      setSearchResults([])
      return
    }
    if (r.bounds) {
      setExternalSelection({
        bounds: r.bounds,
        polygon: null,
      })
      toast.success(`已定位 ${r.name}`)
      setSearchResults([])
      return
    }
    // 仅有点：以点附近 0.05° 半径
    const half = 0.05
    setExternalSelection({
      bounds: {
        north: r.lat + half,
        south: r.lat - half,
        east: r.lng + half,
        west: r.lng - half,
      },
      polygon: null,
    })
    setSearchResults([])
  }

  const importedFilesRef = useRef<File[]>([])

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    importedFilesRef.current = Array.from(files)
    try {
      const file = files[0]
      const name = file.name.toLowerCase()
      let geojson: GeoJsonObject
      if (name.endsWith('.geojson') || name.endsWith('.json')) {
        const text = await file.text()
        geojson = JSON.parse(text) as GeoJsonObject
      } else if (name.endsWith('.zip') || name.endsWith('.shp')) {
        const buf = await file.arrayBuffer()
        geojson = (await shp(buf)) as GeoJsonObject
      } else {
        toast.error('仅支持 .geojson / .json / .zip / .shp')
        return
      }
      const rings = ringsFromGeoJSON(geojson)
      if (rings.length === 0) {
        toast.error('文件中未发现 Polygon / MultiPolygon')
        return
      }

      // 多要素 + 影像/DEM 模式 → 弹出批量模式选择对话框
      const fc = geojson as FeatureCollection
      const features = fc.type === 'FeatureCollection' ? fc.features ?? [] : []
      const mode = useAppStore.getState().mode
      if (
        features.length > 1 &&
        inTauri &&
        (mode === 'imagery' || mode === 'dem')
      ) {
        useBatchStore.getState().open(features, file.name)
        return
      }

      setExternalSelection({ bounds: boundsFromRings(rings), polygon: rings })
      toast.success('边界已导入')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`导入失败：${msg}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 省/市切换时清子项
  useEffect(() => {
    setCityCode('')
    setDistrictCode('')
  }, [provinceCode])
  useEffect(() => {
    setDistrictCode('')
  }, [cityCode])

  if (!inTauri) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        非 Tauri 环境，行政区划与地名搜索不可用
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          区域选择
        </h3>
      </div>

      {/* 地名搜索 */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <Input
            placeholder="搜索地名 (省 / 市 / 区 / POI)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void onSearch()
              }
            }}
          />
          <Button type="button" size="icon" onClick={() => void onSearch()} disabled={searching}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          </Button>
        </div>
        {searchResults.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border bg-popover">
            {searchResults.map((r, idx) => (
              <button
                key={`${r.name}-${idx}`}
                type="button"
                onClick={() => onPickResult(r)}
                className="block w-full border-b border-border/40 px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent"
              >
                <div className="font-medium">{r.name}</div>
                {r.display_name && r.display_name !== r.name && (
                  <div className="truncate text-xs text-muted-foreground">{r.display_name}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 三级联动 */}
      <div className="grid grid-cols-3 gap-1.5">
        <Select value={provinceCode || undefined} onValueChange={(v) => setProvinceCode(v)}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="省份" />
          </SelectTrigger>
          <SelectContent>
            {provincesQuery.data?.map((p) => (
              <SelectItem key={p.code} value={p.code}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={cityCode || undefined}
          onValueChange={(v) => setCityCode(v)}
          disabled={!provinceCode || citiesQuery.isLoading}
        >
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="城市" />
          </SelectTrigger>
          <SelectContent>
            {citiesQuery.data?.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={districtCode || undefined}
          onValueChange={(v) => setDistrictCode(v)}
          disabled={!cityCode || districtsQuery.isLoading}
        >
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="区县" />
          </SelectTrigger>
          <SelectContent>
            {districtsQuery.data?.map((d) => (
              <SelectItem key={d.code} value={d.code}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={onLoadSelectedBoundary}
          disabled={loadingBoundary || (!provinceCode && !cityCode && !districtCode)}
        >
          {loadingBoundary ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <MapPin className="mr-1 size-3.5" />
          )}
          加载行政边界
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          title="上传 GeoJSON / Shapefile"
        >
          <Upload className="mr-1 size-3.5" />
          上传
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => useSelectionStore.getState().clear()}
          title="清除选区"
          className="size-8"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <Label htmlFor="boundary-upload" className="sr-only">上传边界</Label>
      <input
        ref={fileRef}
        id="boundary-upload"
        type="file"
        accept=".geojson,.json,.shp,.zip"
        className="hidden"
        onChange={(e) => void onPickFiles(e.target.files)}
      />
    </section>
  )
}
