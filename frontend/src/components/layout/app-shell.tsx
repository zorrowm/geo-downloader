import type { PropsWithChildren } from 'react'
import { Minus, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { isTauriRuntime } from '@/lib/tauri'

async function withCurrentWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauriRuntime()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()

  if (action === 'minimize') {
    await appWindow.minimize()
    return
  }

  if (action === 'close') {
    await appWindow.close()
    return
  }

  const isMaximized = await appWindow.isMaximized()
  if (isMaximized) {
    await appWindow.unmaximize()
  } else {
    await appWindow.maximize()
  }
}

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div data-tauri-drag-region className="flex h-12 items-center justify-between border-b bg-background px-3">
        <div data-tauri-drag-region className="text-sm font-medium text-muted-foreground">
          GeoDownloader React Preview
        </div>
        <div className="flex items-center gap-1">
          <Button aria-label="最小化" size="icon" variant="ghost" onClick={() => void withCurrentWindow('minimize')}>
            <Minus className="size-4" />
          </Button>
          <Button aria-label="最大化" size="icon" variant="ghost" onClick={() => void withCurrentWindow('toggleMaximize')}>
            <Square className="size-3.5" />
          </Button>
          <Button aria-label="关闭" size="icon" variant="ghost" onClick={() => void withCurrentWindow('close')}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  )
}
