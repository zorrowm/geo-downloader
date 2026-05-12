import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { createSafeJSONStorage } from '@/store/persist-storage'
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

export const useImageryParamsStore = create<ImageryParamsState>()(
  persist(
    (set) => ({
      source: '',
      sourceName: '',
      zoom: 15,
      zoomMax: null,
      format: 'geotiff' as OutputFormat,
      compression: 'lzw',
      buildPyramid: false,
      cropToShape: true,
      concurrency: 30,
      ready: false,
      set: (v) => set((prev) => ({ ...prev, ...v, ready: true })),
    }),
    {
      name: 'geo-downloader:imagery-params',
      version: 1,
      storage: createSafeJSONStorage(),
      partialize: (state) => ({
        format: state.format,
        compression: state.compression,
        buildPyramid: state.buildPyramid,
        cropToShape: state.cropToShape,
        concurrency: state.concurrency,
      }),
    },
  ),
)
