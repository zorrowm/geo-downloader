import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-draw'
import shp from 'shpjs'
import { Eraser, MapPin, Upload } from 'lucide-react'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

import { Button } from '@/components/ui/button'

// 修复 Leaflet 默认图标路径（webpack/vite 下默认图标会 404）
const iconRetinaUrl = new URL(
  'leaflet/dist/images/marker-icon-2x.png',
  import.meta.url,
).href
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export type LatLngRing = { lat: number; lng: number }[]

export interface MapPickerValue {
  bounds: MapBounds | null
  polygon: LatLngRing[] | null
}

export interface MapPickerProps {
  value: MapPickerValue
  onChange: (value: MapPickerValue) => void
  initialBounds?: MapBounds
  height?: number
}

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

export function MapPicker({ value, onChange, initialBounds, height = 360 }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const drawnRef = useRef<L.FeatureGroup | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 初始化地图（只跑一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [35.8617, 104.1954],
      4,
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    const drawn = new L.FeatureGroup()
    map.addLayer(drawn)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawControl = new (L as any).Control.Draw({
      draw: {
        polyline: false,
        marker: false,
        circle: false,
        circlemarker: false,
        polygon: { allowIntersection: false, showArea: true },
        rectangle: {},
      },
      edit: { featureGroup: drawn, remove: true },
    })
    map.addControl(drawControl)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      drawn.clearLayers()
      drawn.addLayer(e.layer)
      if (e.layerType === 'rectangle') {
        const b = e.layer.getBounds() as L.LatLngBounds
        onChangeRef.current({
          bounds: {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          },
          polygon: null,
        })
      } else if (e.layerType === 'polygon') {
        const latlngs = (e.layer.getLatLngs()[0] as L.LatLng[]).map((ll) => ({
          lat: ll.lat,
          lng: ll.lng,
        }))
        const rings = [latlngs]
        onChangeRef.current({ bounds: boundsFromRings(rings), polygon: rings })
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.DELETED, () => {
      onChangeRef.current({ bounds: null, polygon: null })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.EDITED, () => {
      const layers = drawn.getLayers()
      if (layers.length === 0) return
      const layer = layers[0] as L.Layer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyLayer = layer as any
      if (typeof anyLayer.getLatLngs === 'function') {
        const latlngs = (anyLayer.getLatLngs()[0] as L.LatLng[]).map((ll) => ({
          lat: ll.lat,
          lng: ll.lng,
        }))
        const rings = [latlngs]
        onChangeRef.current({ bounds: boundsFromRings(rings), polygon: rings })
      } else if (typeof anyLayer.getBounds === 'function') {
        const b = anyLayer.getBounds() as L.LatLngBounds
        onChangeRef.current({
          bounds: {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          },
          polygon: null,
        })
      }
    })

    mapRef.current = map
    drawnRef.current = drawn

    if (initialBounds) {
      const b = L.latLngBounds(
        [initialBounds.south, initialBounds.west],
        [initialBounds.north, initialBounds.east],
      )
      map.fitBounds(b)
    }

    // 容器尺寸晚到时强制刷新
    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.remove()
      mapRef.current = null
      drawnRef.current = null
    }
  }, [initialBounds])

  // 外部 value 同步：仅当当前没有图层时绘制矩形（避免回环）
  useEffect(() => {
    const map = mapRef.current
    const drawn = drawnRef.current
    if (!map || !drawn) return
    if (drawn.getLayers().length > 0) return
    if (value.polygon && value.polygon.length > 0) {
      const latlngs = value.polygon.map((ring) =>
        ring.map((p) => L.latLng(p.lat, p.lng)),
      )
      const poly = L.polygon(latlngs, { color: '#2563eb' })
      drawn.addLayer(poly)
      map.fitBounds(poly.getBounds(), { animate: false })
    } else if (value.bounds) {
      const b = value.bounds
      const rect = L.rectangle(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        { color: '#2563eb' },
      )
      drawn.addLayer(rect)
      map.fitBounds(rect.getBounds(), { animate: false })
    }
  }, [value])

  const handleClear = () => {
    drawnRef.current?.clearLayers()
    onChangeRef.current({ bounds: null, polygon: null })
  }

  const handleImport = async (file: File) => {
    setError(null)
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const result = (await shp(buf)) as GeoJsonObject
      const rings = ringsFromGeoJSON(result)
      if (rings.length === 0) {
        setError('Shapefile 中未发现 Polygon / MultiPolygon')
        return
      }
      const bounds = boundsFromRings(rings)
      drawnRef.current?.clearLayers()
      const latlngs = rings.map((r) => r.map((p) => L.latLng(p.lat, p.lng)))
      const poly = L.polygon(latlngs, { color: '#2563eb' })
      drawnRef.current?.addLayer(poly)
      mapRef.current?.fitBounds(poly.getBounds(), { animate: false })
      onChangeRef.current({ bounds, polygon: rings })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`导入失败：${msg}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex">
          <input
            type="file"
            accept=".zip,.shp"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
          <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
            <Upload className="mr-1.5 size-4" />
            {importing ? '导入中...' : '导入 Shapefile (.zip)'}
          </span>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
          <Eraser className="mr-1.5 size-4" />
          清除选区
        </Button>
        {value.polygon && (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            <MapPin className="mr-1 size-3" />
            多边形已就绪（{value.polygon.length} 环）
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-md border bg-muted/30"
        style={{ height }}
      />
      <p className="text-xs text-muted-foreground">
        支持矩形 / 多边形绘制，或导入 .zip 打包的 Shapefile（含 .shp/.dbf/.prj，WGS-84 坐标）。
        多边形会自动生成最小外接矩形作为下载范围。
      </p>
    </div>
  )
}
