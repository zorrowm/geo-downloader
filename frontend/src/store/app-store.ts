import { create } from 'zustand'

export type AppMode = 'imagery' | 'dem' | 'wayback' | 'tiles3d' | 'vector'

export interface AppState {
  mode: AppMode
  setMode: (mode: AppMode) => void
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'imagery',
  setMode: (mode) => set({ mode }),
}))
