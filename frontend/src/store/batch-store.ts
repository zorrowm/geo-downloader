import { create } from 'zustand'
import type { Feature } from 'geojson'

export type BatchStage = 'mode' | 'panel'

interface BatchState {
  features: Feature[] | null
  filename: string
  stage: BatchStage | null
  open: (features: Feature[], filename: string) => void
  setStage: (s: BatchStage) => void
  close: () => void
}

export const useBatchStore = create<BatchState>((set) => ({
  features: null,
  filename: '',
  stage: null,
  open: (features, filename) => set({ features, filename, stage: 'mode' }),
  setStage: (s) => set({ stage: s }),
  close: () => set({ features: null, filename: '', stage: null }),
}))
