import type { GeoJsonObject } from 'geojson'
import { create } from 'zustand'

export interface VectorLayerEntry {
  id: string
  filename: string
  geojson: GeoJsonObject
  featureCount: number
}

interface VectorLayersState {
  layers: VectorLayerEntry[]
  /** 自增 revision，用于 MapCanvas 监听增量变化 */
  revision: number
  addLayer: (entry: Omit<VectorLayerEntry, 'id'>) => string
  removeLayer: (id: string) => void
  clear: () => void
}

let seq = 0
function nextId() {
  seq += 1
  return `vec_${Date.now().toString(36)}_${seq}`
}

export const useVectorLayersStore = create<VectorLayersState>((set) => ({
  layers: [],
  revision: 0,
  addLayer: (entry) => {
    const id = nextId()
    set((s) => ({
      layers: [...s.layers, { ...entry, id }],
      revision: s.revision + 1,
    }))
    return id
  },
  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      revision: s.revision + 1,
    })),
  clear: () =>
    set((s) => ({
      layers: [],
      revision: s.revision + 1,
    })),
}))
