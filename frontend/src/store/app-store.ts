import { create } from 'zustand'

export type AppMode = 'imagery' | 'dem' | 'wayback' | 'tiles3d' | 'vector'
export type SidebarTab = 'download' | 'history' | 'settings'

export interface AppState {
  mode: AppMode
  setMode: (mode: AppMode) => void
  tab: SidebarTab
  setTab: (tab: SidebarTab) => void
  /** 当前选中的图源 key（供地图预览哌应） */
  selectedSource: string | null
  setSelectedSource: (key: string | null) => void
  /** 当前选中的行政区划代码（街道/区县/城市/省），用于边界下载 */
  currentAdminCode: string | null
  setCurrentAdminCode: (code: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'imagery',
  setMode: (mode) => set({ mode }),
  tab: 'download',
  setTab: (tab) => set({ tab }),
  selectedSource: null,
  setSelectedSource: (key) => set({ selectedSource: key }),
  currentAdminCode: null,
  setCurrentAdminCode: (code) => set({ currentAdminCode: code }),
}))
