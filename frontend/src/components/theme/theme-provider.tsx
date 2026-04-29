import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeAccent = 'zinc' | 'blue' | 'green' | 'violet' | 'orange'

interface ThemeContextValue {
  mode: ThemeMode
  accent: ThemeAccent
  resolvedMode: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
  setAccent: (a: ThemeAccent) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const MODE_KEY = 'gd:theme-mode'
const ACCENT_KEY = 'gd:theme-accent'

function readMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const v = localStorage.getItem(MODE_KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

function readAccent(): ThemeAccent {
  if (typeof localStorage === 'undefined') return 'zinc'
  const v = localStorage.getItem(ACCENT_KEY)
  if (v === 'zinc' || v === 'blue' || v === 'green' || v === 'violet' || v === 'orange') return v
  return 'zinc'
}

function resolveSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(() => readMode())
  const [accent, setAccent] = useState<ThemeAccent>(() => readAccent())
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(() => resolveSystemMode())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedMode: 'light' | 'dark' = mode === 'system' ? systemMode : mode

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolvedMode)
    root.dataset.accent = accent
  }, [resolvedMode, accent])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {
      // ignore
    }
  }, [mode, accent])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, accent, resolvedMode, setMode, setAccent }),
    [mode, accent, resolvedMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
