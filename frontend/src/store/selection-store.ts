import { create } from 'zustand'

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export type LatLngRing = { lat: number; lng: number }[]

/** 单个导入要素（来自 GeoJSON/Shapefile/KML/KMZ 中的单个 Feature） */
export interface ImportedFeature {
  name: string
  bounds: MapBounds
  rings: LatLngRing[]
}

export interface SelectionState {
  bounds: MapBounds | null
  polygon: LatLngRing[] | null
  /** 多要素导入：每个要素单独保留，便于下载时选择「合并」或「拆分为 N 个任务」 */
  features: ImportedFeature[] | null
  /** 自增版本号：每次外部（数字框/边界加载等）写入 +1，用于通知地图同步绘制 */
  externalRevision: number
  setSelection: (next: { bounds: MapBounds | null; polygon: LatLngRing[] | null }) => void
  setBoundsFromInputs: (bounds: MapBounds) => void
  /** 外部（行政边界/上传 GeoJSON 等）整体设置选区，会触发地图重绘 */
  setExternalSelection: (next: {
    bounds: MapBounds | null
    polygon: LatLngRing[] | null
    features?: ImportedFeature[] | null
  }) => void
  clear: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  bounds: null,
  polygon: null,
  features: null,
  externalRevision: 0,
  setSelection: ({ bounds, polygon }) => set({ bounds, polygon, features: null }),
  setBoundsFromInputs: (bounds) =>
    set((s) => ({
      bounds,
      polygon: null,
      features: null,
      externalRevision: s.externalRevision + 1,
    })),
  setExternalSelection: ({ bounds, polygon, features }) =>
    set((s) => ({
      bounds,
      polygon,
      features: features ?? null,
      externalRevision: s.externalRevision + 1,
    })),
  clear: () =>
    set((s) => ({
      bounds: null,
      polygon: null,
      features: null,
      externalRevision: s.externalRevision + 1,
    })),
}))
