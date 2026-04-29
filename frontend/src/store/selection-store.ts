import { create } from 'zustand'

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export type LatLngRing = { lat: number; lng: number }[]

export interface SelectionState {
  bounds: MapBounds | null
  polygon: LatLngRing[] | null
  /** 自增版本号：每次外部（数字框/边界加载等）写入 +1，用于通知地图同步绘制 */
  externalRevision: number
  setSelection: (next: { bounds: MapBounds | null; polygon: LatLngRing[] | null }) => void
  setBoundsFromInputs: (bounds: MapBounds) => void
  /** 外部（行政边界/上传 GeoJSON 等）整体设置选区，会触发地图重绘 */
  setExternalSelection: (next: { bounds: MapBounds | null; polygon: LatLngRing[] | null }) => void
  clear: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  bounds: { north: 39.99, south: 39.85, east: 116.5, west: 116.3 },
  polygon: null,
  externalRevision: 0,
  setSelection: ({ bounds, polygon }) => set({ bounds, polygon }),
  setBoundsFromInputs: (bounds) =>
    set((s) => ({
      bounds,
      polygon: null,
      externalRevision: s.externalRevision + 1,
    })),
  setExternalSelection: ({ bounds, polygon }) =>
    set((s) => ({
      bounds,
      polygon,
      externalRevision: s.externalRevision + 1,
    })),
  clear: () =>
    set((s) => ({ bounds: null, polygon: null, externalRevision: s.externalRevision + 1 })),
}))
