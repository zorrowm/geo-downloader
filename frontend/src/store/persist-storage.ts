import { createJSONStorage, type StateStorage } from 'zustand/middleware'

const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(name, value)
    } catch {
      // localStorage may be unavailable in restricted environments.
    }
  },
  removeItem: (name) => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.removeItem(name)
    } catch {
      // localStorage may be unavailable in restricted environments.
    }
  },
}

export function createSafeJSONStorage() {
  return createJSONStorage(() => safeLocalStorage)
}
