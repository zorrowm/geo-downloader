import { create } from 'zustand'
import type { OutputFormat } from '@/types/api'

export interface ImageryParamsSnapshot {
  source: string
  sourceName: string
  zoom: number
  zoomMax: number | null
  format: OutputFormat
  compression: 'none' | 'lzw' | 'deflate'
  buildPyramid: boolean
  cropToShape: boolean
  concurrency: number
  ready: boolean
}

interface ImageryParamsState extends ImageryParamsSnapshot {
  set: (v: Partial<ImageryParamsSnapshot>) => void
}

export const useImageryParamsStore = create<ImageryParamsState>((set) => ({
  source: '',
  sourceName: '',
  zoom: 15,
  zoomMax: null,
  format: 'geotiff' as OutputFormat,
  compression: 'none',
  buildPyramid: false,
  cropToShape: false,
  concurrency: 30,
  ready: false,
  set: (v) => set((prev) => ({ ...prev, ...v, ready: true })),
}))
