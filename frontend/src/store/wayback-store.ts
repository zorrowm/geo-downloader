import { create } from 'zustand'

interface WaybackPreviewState {
  /** 当前预览中的 Wayback 版本 id（数字 key），null 时不预览 */
  previewVersionId: string | null
  setPreviewVersionId: (id: string | null) => void
}

export const useWaybackStore = create<WaybackPreviewState>((set) => ({
  previewVersionId: null,
  setPreviewVersionId: (id) => set({ previewVersionId: id }),
}))
