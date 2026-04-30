import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-draw'
import { useQuery } from '@tanstack/react-query'

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

import {
  useSelectionStore,
  type LatLngRing,
  type MapBounds,
} from '@/store/selection-store'
import { useAppStore } from '@/store/app-store'
import { useVectorLayersStore } from '@/store/vector-layers-store'
import { useWaybackStore } from '@/store/wayback-store'
import { getSettings } from '@/features/settings/settings-api'
import { getTileSourcesMerged } from '@/features/sources/sources-api'
import type { TileSource } from '@/types/api'

// 修复 Leaflet 默认图标路径
const iconRetinaUrl = new URL(
  'leaflet/dist/images/marker-icon-2x.png',
  import.meta.url,
).href
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })

// 修复 leaflet-draw 1.0.4 的 readableArea ReferenceError(type is not defined)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(L as any).GeometryUtil = (L as any).GeometryUtil || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(L as any).GeometryUtil.readableArea = function (area: number) {
  if (area >= 1_000_000) return (area / 1_000_000).toFixed(2) + ' km²'
  if (area >= 10_000) return (area / 10_000).toFixed(2) + ' ha'
  return area.toFixed(0) + ' m²'
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const drawnRef = useRef<L.FeatureGroup | null>(null)
  const lastRevRef = useRef(-1)
  // 图层管理
  const baseLayersRef = useRef<Map<string, L.TileLayer>>(new Map())
  const currentBaseLayerKeyRef = useRef<string | null>(null)
  const layerControlRef = useRef<L.Control.Layers | null>(null)
  const overlayLayersRef = useRef<L.TileLayer[]>([])
  // 本地加载的矢量图层
  const vectorLayerMapRef = useRef<Map<string, L.GeoJSON>>(new Map())
  // Wayback 历史影像预览图层
  const waybackLayerRef = useRef<L.TileLayer | null>(null)
  const [error] = useState<string | null>(null)
  const [statusCoords, setStatusCoords] = useState<string>('经度: --  纬度: --')
  const [statusZoom, setStatusZoom] = useState<string>('缩放: --')

  const setSelection = useSelectionStore((s) => s.setSelection)
  const externalRevision = useSelectionStore((s) => s.externalRevision)
  const bounds = useSelectionStore((s) => s.bounds)
  const polygon = useSelectionStore((s) => s.polygon)
  const selectedSource = useAppStore((s) => s.selectedSource)
  const vectorLayers = useVectorLayersStore((s) => s.layers)
  const vectorRevision = useVectorLayersStore((s) => s.revision)
  const waybackPreviewId = useWaybackStore((s) => s.previewVersionId)

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const tdtToken = settingsQuery.data?.tianditu_token ?? null
  const sourcesQuery = useQuery({
    queryKey: ['tile-sources-merged', tdtToken],
    queryFn: () => getTileSourcesMerged(tdtToken),
  })

  // 初始化地图
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [35.8617, 104.1954],
      4,
    )
    // 占位底图，等图源列表加载后会切换
    const fallback = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    baseLayersRef.current.set('__fallback', fallback)
    currentBaseLayerKeyRef.current = '__fallback'
    const drawn = new L.FeatureGroup()
    map.addLayer(drawn)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawControl = new (L as any).Control.Draw({
      position: 'topleft',
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
        setSelection({
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
        setSelection({ bounds: boundsFromRings(rings), polygon: rings })
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.DELETED, () => {
      setSelection({ bounds: null, polygon: null })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.EDITED, () => {
      const layers = drawn.getLayers()
      if (layers.length === 0) return
      const layer = layers[0] as L.Layer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyLayer = layer as any
      if (anyLayer instanceof L.Rectangle) {
        const b = anyLayer.getBounds() as L.LatLngBounds
        setSelection({
          bounds: {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          },
          polygon: null,
        })
      } else if (typeof anyLayer.getLatLngs === 'function') {
        const latlngs = (anyLayer.getLatLngs()[0] as L.LatLng[]).map((ll) => ({
          lat: ll.lat,
          lng: ll.lng,
        }))
        const rings = [latlngs]
        setSelection({ bounds: boundsFromRings(rings), polygon: rings })
      }
    })

    mapRef.current = map
    drawnRef.current = drawn

    // 状态栏：鼠标经纬度 + 缩放级别
    setStatusZoom(`缩放: ${map.getZoom()}`)
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setStatusCoords(
        `经度: ${e.latlng.lng.toFixed(6)}  纬度: ${e.latlng.lat.toFixed(6)}`,
      )
    })
    map.on('mouseout', () => setStatusCoords('经度: --  纬度: --'))
    map.on('zoomend', () => setStatusZoom(`缩放: ${map.getZoom()}`))

    // 容器尺寸晚到时刷新
    requestAnimationFrame(() => map.invalidateSize())
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      drawnRef.current = null
    }
  }, [setSelection])

  // 外部数字框 / 清除按钮触发的同步：仅当 externalRevision 变化时绘制
  useEffect(() => {
    const map = mapRef.current
    const drawn = drawnRef.current
    if (!map || !drawn) return
    if (externalRevision === lastRevRef.current) return
    lastRevRef.current = externalRevision

    drawn.clearLayers()
    if (polygon && polygon.length > 0) {
      const latlngs = polygon.map((ring) => ring.map((p) => L.latLng(p.lat, p.lng)))
      const poly = L.polygon(latlngs, { color: '#2563eb' })
      drawn.addLayer(poly)
      map.fitBounds(poly.getBounds(), { animate: false, maxZoom: 14 })
    } else if (bounds) {
      const rect = L.rectangle(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { color: '#2563eb' },
      )
      drawn.addLayer(rect)
      map.fitBounds(rect.getBounds(), { animate: false, maxZoom: 14 })
    }
  }, [externalRevision, bounds, polygon])

  // 根据图源数据 + 当前选中图源构建 / 切换底图，并装配图层控件
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourcesQuery.data) return
    const sources = sourcesQuery.data

    const cache = baseLayersRef.current
    // 移除已不存在或 url 改变的旧图层
    for (const [k, layer] of cache) {
      if (k === '__fallback') continue
      const cfg = sources[k]
      const expectedUrl = (cfg as { url?: string } | undefined)?.url
      const layerUrl = (layer as L.TileLayer & { _url?: string })._url
      if (!cfg || layerUrl !== expectedUrl) {
        if (map.hasLayer(layer)) map.removeLayer(layer)
        cache.delete(k)
      }
    }
    for (const [key, cfg] of Object.entries(sources)) {
      if (cache.has(key)) continue
      const c = cfg as TileSource & {
        url?: string
        subdomains?: string[]
        max_zoom?: number
        attribution?: string
      }
      if (!c.url) continue
      try {
        const layer = L.tileLayer(c.url, {
          attribution: c.attribution ?? '',
          maxZoom: c.max_zoom ?? 22,
          subdomains: c.subdomains ?? 'abc',
        })
        cache.set(key, layer)
      } catch {
        // skip bad url
      }
    }

    // 重建天地图标注 overlay
    overlayLayersRef.current.forEach((l) => {
      if (map.hasLayer(l)) map.removeLayer(l)
    })
    overlayLayersRef.current = []
    const tdt = tdtToken || '436ce7e50d27eede2f2929307e6b33c0'
    const tdtSubdomains = ['0', '1', '2', '3', '4', '5', '6', '7']
    const ciaLayer = L.tileLayer(
      `https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tdt}`,
      { subdomains: tdtSubdomains, maxZoom: 18, attribution: '天地图' },
    )
    const cvaLayer = L.tileLayer(
      `https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tdt}`,
      { subdomains: tdtSubdomains, maxZoom: 18, attribution: '天地图' },
    )
    overlayLayersRef.current = [ciaLayer, cvaLayer]

    // 重建图层控件
    if (layerControlRef.current) {
      layerControlRef.current.remove()
      layerControlRef.current = null
    }
    const baseMaps: Record<string, L.TileLayer> = {}
    const sortedKeys = [...Object.keys(sources)].sort((a, b) =>
      ((sources[a] as { name?: string }).name || '').localeCompare(
        (sources[b] as { name?: string }).name || '',
      ),
    )
    for (const key of sortedKeys) {
      const layer = cache.get(key)
      if (layer) baseMaps[(sources[key] as { name?: string }).name || key] = layer
    }
    layerControlRef.current = L.control
      .layers(
        baseMaps,
        {
          '天地图 影像标注': ciaLayer,
          '天地图 矢量标注': cvaLayer,
        },
        { position: 'topleft', collapsed: true },
      )
      .addTo(map)
  }, [sourcesQuery.data, tdtToken])

  // 监听选中图源 → 切换底图
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedSource) return
    const cache = baseLayersRef.current
    const target = cache.get(selectedSource)
    if (!target) return
    if (currentBaseLayerKeyRef.current === selectedSource) return
    const prevKey = currentBaseLayerKeyRef.current
    if (prevKey) {
      const prev = cache.get(prevKey)
      if (prev && map.hasLayer(prev)) map.removeLayer(prev)
    }
    target.addTo(map)
    target.bringToBack?.()
    currentBaseLayerKeyRef.current = selectedSource
  }, [selectedSource, sourcesQuery.data])

  // 同步本地矢量图层（按 revision 增量 diff）
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c']
    const cache = vectorLayerMapRef.current
    const currentIds = new Set(vectorLayers.map((l) => l.id))

    // 移除不再存在的图层
    for (const [id, layer] of cache) {
      if (!currentIds.has(id)) {
        if (map.hasLayer(layer)) map.removeLayer(layer)
        cache.delete(id)
      }
    }

    // 新增图层
    let lastBounds: L.LatLngBounds | null = null
    vectorLayers.forEach((entry, idx) => {
      if (cache.has(entry.id)) return
      const color = colors[idx % colors.length]
      const layer = L.geoJSON(entry.geojson as never, {
        style: () => ({ color, fillColor: color, fillOpacity: 0.3, weight: 2 }),
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, {
            radius: 6,
            fillColor: color,
            color: '#fff',
            weight: 1,
            fillOpacity: 0.8,
          }),
        onEachFeature: (feature, lyr) => {
          if (feature?.properties) {
            const html = Object.entries(feature.properties as Record<string, unknown>)
              .filter(([, v]) => v !== null && v !== '')
              .slice(0, 10)
              .map(
                ([k, v]) =>
                  `<b>${escapeHtml(String(k))}:</b> ${escapeHtml(String(v))}`,
              )
              .join('<br>')
            if (html) lyr.bindPopup(html)
          }
        },
      })
      layer.addTo(map)
      cache.set(entry.id, layer)
      try {
        const b = layer.getBounds()
        if (b.isValid()) lastBounds = b
      } catch {
        // ignore
      }
    })

    if (lastBounds) {
      map.fitBounds(lastBounds, { animate: false })
    }
  }, [vectorLayers, vectorRevision])

  // 同步 Wayback 预览图层
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (waybackLayerRef.current) {
      if (map.hasLayer(waybackLayerRef.current)) map.removeLayer(waybackLayerRef.current)
      waybackLayerRef.current = null
    }
    if (waybackPreviewId) {
      const url = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${waybackPreviewId}/{z}/{y}/{x}`
      const layer = L.tileLayer(url, { maxZoom: 19, attribution: 'Esri Wayback' })
      layer.addTo(map)
      layer.bringToFront?.()
      waybackLayerRef.current = layer
    }
  }, [waybackPreviewId])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      {error && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
          <div className="pointer-events-auto rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive shadow-sm">
            {error}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur tabular-nums">
        <span>{statusCoords}</span>
        <span className="text-muted-foreground/40">|</span>
        <span>{statusZoom}</span>
      </div>
    </div>
  )
}
