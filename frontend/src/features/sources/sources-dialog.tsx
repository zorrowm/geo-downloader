import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSettings, saveSettings } from '@/features/settings/settings-api'
import {
  blankCustomSource,
  builtinToOverrideDraft,
  getBuiltinSourcesRaw,
  getTileSourcesMerged,
  removeCustomSource,
  resetSourceOverride,
  upsertCustomSource,
  upsertSourceOverride,
} from './sources-api'
import type { AppSettings, CustomTileSource, TileSource } from '@/types/api'

type SourceFormProps = {
  value: CustomTileSource
  onChange: (next: CustomTileSource) => void
  disableId?: boolean
}

function SourceForm({ value, onChange, disableId }: SourceFormProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`name-${value.id}`}>名称</Label>
        <Input
          id={`name-${value.id}`}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="例如 高德矢量"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`url-${value.id}`}>URL 模板</Label>
        <Input
          id={`url-${value.id}`}
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          placeholder="https://example.com/{z}/{x}/{y}.png  支持 {s}/{x}/{y}/{z}"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`sub-${value.id}`}>子域名（逗号分隔）</Label>
        <Input
          id={`sub-${value.id}`}
          value={value.subdomains ?? ''}
          onChange={(e) => onChange({ ...value, subdomains: e.target.value })}
          placeholder="a,b,c 可空"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`zoom-${value.id}`}>最大缩放级别</Label>
        <Input
          id={`zoom-${value.id}`}
          type="number"
          min={0}
          max={22}
          value={value.max_zoom ?? 18}
          onChange={(e) =>
            onChange({ ...value, max_zoom: Number(e.target.value) || 0 })
          }
        />
      </div>
      {!disableId && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-muted-foreground">ID</Label>
          <code className="block rounded border bg-muted px-2 py-1 text-xs">{value.id}</code>
        </div>
      )}
    </div>
  )
}

function validateSource(s: CustomTileSource): string | null {
  if (!s.name.trim()) return '名称不能为空'
  if (!s.url.trim()) return 'URL 模板不能为空'
  if (!/\{x\}/.test(s.url) || !/\{y\}/.test(s.url) || !/\{z\}/.test(s.url)) {
    return 'URL 模板必须包含 {x} {y} {z} 占位符'
  }
  if (typeof s.max_zoom !== 'number' || s.max_zoom < 0 || s.max_zoom > 22) {
    return '最大缩放级别需在 0-22'
  }
  return null
}

function CustomPanel({
  settings,
  onMutate,
  pending,
}: {
  settings: AppSettings
  onMutate: (next: AppSettings) => void
  pending: boolean
}) {
  const list = useMemo(() => settings.custom_sources ?? [], [settings.custom_sources])
  const [editing, setEditing] = useState<CustomTileSource | null>(null)
  const isNew = useMemo(
    () => !!editing && !list.some((s) => s.id === editing.id),
    [editing, list],
  )

  function handleSave() {
    if (!editing) return
    const err = validateSource(editing)
    if (err) {
      toast.error(err)
      return
    }
    onMutate(upsertCustomSource(settings, editing))
    setEditing(null)
  }

  function handleDelete(id: string) {
    onMutate(removeCustomSource(settings, id))
    if (editing?.id === id) setEditing(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          自定义图源会与内置图源一起出现在下载页的图源选择中。
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing(blankCustomSource())}
          disabled={pending}
        >
          <Plus className="mr-1 size-4" />
          新增
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          尚未添加自定义图源
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    z≤{s.max_zoom}
                  </Badge>
                </div>
                <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {s.url}
                </code>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing({ ...s })}
                  disabled={pending}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(s.id)}
                  disabled={pending}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="space-y-3 rounded-md border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{isNew ? '新增图源' : '编辑图源'}</h4>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={pending}
            >
              <X className="size-4" />
            </Button>
          </div>
          <SourceForm value={editing} onChange={setEditing} disableId={isNew} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={pending}>
              <Save className="mr-1 size-4" />
              确认
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function OverridesPanel({
  settings,
  builtins,
  onMutate,
  pending,
}: {
  settings: AppSettings
  builtins: Record<string, TileSource>
  onMutate: (next: AppSettings) => void
  pending: boolean
}) {
  const overrides = useMemo(
    () => settings.source_overrides ?? [],
    [settings.source_overrides],
  )
  const overrideMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o] as const)),
    [overrides],
  )
  const builtinList = useMemo(
    () =>
      Object.values(builtins).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [builtins],
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomTileSource | null>(null)

  function startEdit(builtin: TileSource) {
    const id = builtin.id ?? builtin.key
    if (!id) return
    const existing = overrideMap.get(id)
    setEditingId(id)
    setDraft(existing ? { ...existing } : builtinToOverrideDraft(builtin))
  }

  function handleSave() {
    if (!draft) return
    const err = validateSource(draft)
    if (err) {
      toast.error(err)
      return
    }
    onMutate(upsertSourceOverride(settings, draft))
    setEditingId(null)
    setDraft(null)
  }

  function handleReset(id: string) {
    onMutate(resetSourceOverride(settings, id))
    if (editingId === id) {
      setEditingId(null)
      setDraft(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        覆盖内置图源的 URL / 子域名 / 最大缩放级别。重置后恢复程序内置默认值。
      </p>
      <ul className="space-y-2">
        {builtinList.map((b) => {
          const id = b.id ?? b.key ?? ''
          const isOverridden = overrideMap.has(id)
          const isEditing = editingId === id
          return (
            <li key={id} className="rounded-md border">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    <code className="text-xs text-muted-foreground">{id}</code>
                    {isOverridden && (
                      <Badge variant="default" className="text-xs">
                        已覆盖
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(b)}
                    disabled={pending}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {isOverridden && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReset(id)}
                      disabled={pending}
                    >
                      <RotateCcw className="size-4 text-amber-600" />
                    </Button>
                  )}
                </div>
              </div>
              {isEditing && draft && (
                <div className="space-y-3 border-t bg-muted/40 p-4">
                  <SourceForm value={draft} onChange={setDraft} />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingId(null)
                        setDraft(null)
                      }}
                      disabled={pending}
                    >
                      取消
                    </Button>
                    <Button onClick={handleSave} disabled={pending}>
                      <Save className="mr-1 size-4" />
                      确认
                    </Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function DefaultSourcePanel({
  settings,
  merged,
  onMutate,
  pending,
}: {
  settings: AppSettings
  merged: Record<string, TileSource>
  onMutate: (next: AppSettings) => void
  pending: boolean
}) {
  const list = useMemo(
    () =>
      Object.values(merged).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [merged],
  )
  const current = settings.default_source ?? ''

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        选中的图源会作为下载页面的默认图源。点击行即可设为默认。
      </p>
      <ul className="space-y-2">
        {list.map((s) => {
          const id = s.id ?? s.key ?? ''
          const active = id === current
          return (
            <li
              key={id}
              className={`flex items-center justify-between rounded-md border p-3 transition-colors ${
                active ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <code className="text-xs text-muted-foreground">{id}</code>
                  {active && (
                    <Badge variant="default" className="text-xs">
                      默认
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={active ? 'secondary' : 'outline'}
                disabled={pending || active}
                onClick={() => onMutate({ ...settings, default_source: id })}
              >
                {active ? '当前默认' : '设为默认'}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SourcesDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: open,
  })
  const tiandituToken = settingsQuery.data?.tianditu_token ?? null
  const builtinsQuery = useQuery({
    queryKey: ['builtin-sources', tiandituToken],
    queryFn: () => getBuiltinSourcesRaw(tiandituToken),
    enabled: open,
  })
  const mergedQuery = useQuery({
    queryKey: ['tile-sources-merged', tiandituToken],
    queryFn: () => getTileSourcesMerged(tiandituToken),
    enabled: open,
  })

  // 本地编辑态：保存按钮触发后才写后端
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [syncedFrom, setSyncedFrom] = useState<AppSettings | undefined>(undefined)
  if (settingsQuery.data !== syncedFrom) {
    // 渲染期同步：避免 setState-in-effect
    setSyncedFrom(settingsQuery.data)
    setDraft(settingsQuery.data ?? null)
  }

  const dirty = useMemo(() => {
    if (!draft || !settingsQuery.data) return false
    return (
      JSON.stringify(draft.custom_sources ?? []) !==
        JSON.stringify(settingsQuery.data.custom_sources ?? []) ||
      JSON.stringify(draft.source_overrides ?? []) !==
        JSON.stringify(settingsQuery.data.source_overrides ?? []) ||
      (draft.default_source ?? '') !== (settingsQuery.data.default_source ?? '')
    )
  }, [draft, settingsQuery.data])

  const mutation = useMutation({
    mutationFn: (next: AppSettings) => saveSettings(next),
    onSuccess: () => {
      toast.success('图源配置已保存')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['tile-sources-merged'] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`保存失败：${msg}`)
    },
  })

  const loading = settingsQuery.isLoading || builtinsQuery.isLoading || mergedQuery.isLoading
  const fetchError = settingsQuery.error ?? builtinsQuery.error ?? mergedQuery.error

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setDraft(null)
          setSyncedFrom(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Database className="size-4" />
          图源管理
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>图源管理</DialogTitle>
          <DialogDescription>
            管理自定义图源、覆盖内置图源参数、设置默认图源。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在加载图源数据...
          </div>
        ) : fetchError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            读取图源失败：{fetchError instanceof Error ? fetchError.message : String(fetchError)}
          </div>
        ) : draft && builtinsQuery.data && mergedQuery.data ? (
          <Tabs defaultValue="custom" className="space-y-4">
            <TabsList className="w-full">
              <TabsTrigger value="custom" className="flex-1">
                自定义图源
              </TabsTrigger>
              <TabsTrigger value="overrides" className="flex-1">
                内置覆盖
              </TabsTrigger>
              <TabsTrigger value="default" className="flex-1">
                默认图源
              </TabsTrigger>
            </TabsList>
            <TabsContent value="custom">
              <CustomPanel
                settings={draft}
                onMutate={setDraft}
                pending={mutation.isPending}
              />
            </TabsContent>
            <TabsContent value="overrides">
              <OverridesPanel
                settings={draft}
                builtins={builtinsQuery.data}
                onMutate={setDraft}
                pending={mutation.isPending}
              />
            </TabsContent>
            <TabsContent value="default">
              <DefaultSourcePanel
                settings={draft}
                merged={mergedQuery.data}
                onMutate={setDraft}
                pending={mutation.isPending}
              />
            </TabsContent>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {dirty ? '有未保存的修改' : '已与服务端同步'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDraft(settingsQuery.data ?? null)}
                  disabled={!dirty || mutation.isPending}
                >
                  撤销
                </Button>
                <Button
                  onClick={() => draft && mutation.mutate(draft)}
                  disabled={!dirty || mutation.isPending}
                >
                  {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
