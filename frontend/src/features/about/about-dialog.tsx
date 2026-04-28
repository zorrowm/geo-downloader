import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { isTauriRuntime } from '@/lib/tauri'

async function loadAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return 'web 预览'
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}

async function loadTauriVersion(): Promise<string> {
  if (!isTauriRuntime()) return 'web 预览'
  const { getTauriVersion } = await import('@tauri-apps/api/app')
  return getTauriVersion()
}

export function AboutDialog() {
  const appVersion = useQuery({ queryKey: ['app', 'version'], queryFn: loadAppVersion })
  const tauriVersion = useQuery({
    queryKey: ['app', 'tauri-version'],
    queryFn: loadTauriVersion,
  })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info className="size-4" />
          关于
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>GeoDownloader</DialogTitle>
          <DialogDescription>
            遥感影像、DEM、Wayback、3D Tiles 与矢量瓦片的桌面下载工具。
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">应用版本</dt>
          <dd className="font-medium">
            {appVersion.isLoading
              ? '加载中…'
              : appVersion.error
                ? '读取失败'
                : (appVersion.data ?? '-')}
          </dd>
          <dt className="text-muted-foreground">Tauri 版本</dt>
          <dd className="font-medium">
            {tauriVersion.isLoading
              ? '加载中…'
              : tauriVersion.error
                ? '读取失败'
                : (tauriVersion.data ?? '-')}
          </dd>
          <dt className="text-muted-foreground">运行环境</dt>
          <dd className="font-medium">{isTauriRuntime() ? 'Tauri WebView2' : '浏览器预览'}</dd>
        </dl>

        <DialogFooter>
          <Button asChild variant="outline">
            <a href="https://github.com/gaopengbin/geo-downloader" target="_blank" rel="noreferrer">
              GitHub 仓库
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
