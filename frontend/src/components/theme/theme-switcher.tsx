import { Moon, Palette, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme, type ThemeAccent } from './theme-provider'

const ACCENTS: { value: ThemeAccent; label: string; color: string }[] = [
  { value: 'zinc', label: '中性灰', color: 'bg-zinc-900' },
  { value: 'blue', label: '靛蓝', color: 'bg-blue-600' },
  { value: 'green', label: '翠绿', color: 'bg-green-600' },
  { value: 'violet', label: '紫罗兰', color: 'bg-violet-600' },
  { value: 'orange', label: '橙色', color: 'bg-orange-500' },
]

export function ThemeSwitcher() {
  const { accent, resolvedMode, setMode, setAccent } = useTheme()
  const isDark = resolvedMode === 'dark'

  return (
    <>
      {/* 一键切换亮/暗 */}
      <Button
        size="icon"
        variant="ghost"
        aria-label={isDark ? '切换到浅色' : '切换到深色'}
        title={isDark ? '切换到浅色' : '切换到深色'}
        onClick={() => setMode(isDark ? 'light' : 'dark')}
      >
        {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>

      {/* 主色下拉 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="主色" title="主色">
            <Palette className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          {ACCENTS.map((a) => (
            <DropdownMenuItem
              key={a.value}
              onSelect={() => setAccent(a.value)}
              className="flex items-center gap-2"
            >
              <span className={`inline-block size-3 rounded-full ${a.color}`} />
              <span className="flex-1">{a.label}</span>
              {accent === a.value && (
                <span className="text-xs text-muted-foreground">当前</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
