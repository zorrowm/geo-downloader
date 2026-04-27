import { Activity, Boxes, CalendarClock, Download, Layers, Map, Settings } from 'lucide-react'

import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function App() {
  const migrationSteps = [
    { title: '设置与图源', description: '迁移应用设置、自定义图源和更新检查', status: '准备中' },
    { title: '地图选择', description: 'Leaflet 绘制、行政区划和地名搜索', status: '待迁移' },
    { title: '下载任务', description: '单级别、多级别、DEM、历史和断点续传', status: '待迁移' },
    { title: 'Wayback', description: 'fast/fine 扫描、时间轴和增量下载', status: '待迁移' },
    { title: '3D Tiles', description: 'Cesium 预览、模型调控和本地服务', status: '待迁移' },
  ]

  return (
    <AppShell>
      <section className="grid min-h-[calc(100vh-3rem)] grid-cols-[320px_1fr] bg-muted/30">
        <aside className="border-r bg-background/95 p-5 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Map className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">GeoDownloader</h1>
              <p className="mt-1 text-xs text-muted-foreground">React 迁移工作台</p>
            </div>
          </div>

          <div className="space-y-3">
            <Button className="w-full justify-start" variant="secondary">
              <Download className="size-4" />
              下载任务
            </Button>
            <Button className="w-full justify-start" variant="ghost">
              <Layers className="size-4" />
              图源与图层
            </Button>
            <Button className="w-full justify-start" variant="ghost">
              <CalendarClock className="size-4" />
              Wayback 历史影像
            </Button>
            <Button className="w-full justify-start" variant="ghost">
              <Boxes className="size-4" />
              3D Tiles
            </Button>
            <Button className="w-full justify-start" variant="ghost">
              <Settings className="size-4" />
              设置
            </Button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between border-b bg-background/80 px-6 py-4 backdrop-blur">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Phase 1</Badge>
                <Badge variant="outline">Vite + React + shadcn/ui</Badge>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">前端重构空壳已就位</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                当前阶段只建立新入口和组件体系，不替换旧版 static 前端。
              </p>
            </div>
            <Button variant="outline">
              <Activity className="size-4" />
              构建检查
            </Button>
          </header>

          <div className="grid flex-1 grid-cols-[1fr_360px] gap-5 p-5">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>地图画布占位</CardTitle>
                <CardDescription>
                  后续 Leaflet / Cesium 会在这里按 feature 分阶段接入。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid h-[520px] place-items-center rounded-xl border border-dashed bg-[linear-gradient(135deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(225deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(315deg,hsl(var(--muted))_25%,hsl(var(--background))_25%)] bg-[length:28px_28px] bg-[position:14px_0,14px_0,0_0,0_0] text-center">
                  <div>
                    <Map className="mx-auto mb-4 size-10 text-muted-foreground" />
                    <p className="text-sm font-medium">旧版 `static/` 仍是当前生产入口</p>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">
                      React 版会先并行构建，完成回归后再切换 Tauri `frontendDist`。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>迁移阶段</CardTitle>
                <CardDescription>按文档逐段迁移，避免巨石重构失控。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {migrationSteps.map((step, index) => (
                  <div key={step.title} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {index + 1}. {step.title}
                      </div>
                      <Badge variant={index === 0 ? 'secondary' : 'outline'}>{step.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </main>
      </section>
    </AppShell>
  )
}

export default App
