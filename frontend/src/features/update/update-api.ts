import { isTauriRuntime } from '@/lib/tauri'
import { useUpdateStore } from './update-store'

const GITHUB_REPO = 'gaopengbin/geo-downloader'

interface GithubAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  html_url: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GithubAsset[]
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-')
    const main = core.split('.').map((n) => parseInt(n, 10) || 0)
    const preParts = pre
      ? pre.split('.').map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p))
      : null
    return { main, pre: preParts }
  }
  const va = parse(a)
  const vb = parse(b)
  for (let i = 0; i < 3; i++) {
    const na = va.main[i] || 0
    const nb = vb.main[i] || 0
    if (na !== nb) return na > nb ? 1 : -1
  }
  if (!va.pre && !vb.pre) return 0
  if (!va.pre) return 1
  if (!vb.pre) return -1
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const pa = va.pre[i]
    const pb = vb.pre[i]
    if (pa === undefined) return -1
    if (pb === undefined) return 1
    if (typeof pa === 'number' && typeof pb === 'number') {
      if (pa !== pb) return pa > pb ? 1 : -1
    } else if (typeof pa === typeof pb) {
      if (pa !== pb) return (pa as string) > (pb as string) ? 1 : -1
    } else {
      return typeof pa === 'number' ? -1 : 1
    }
  }
  return 0
}

export function extractKeyUpdates(body?: string): string[] {
  if (!body) return []
  const updates: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      let content = trimmed.slice(1).trim()
      const boldMatch = content.match(/\*\*(.+?)\*\*/)
      if (boldMatch) content = boldMatch[1]
      if (content.length > 0 && content.length < 60) updates.push(content)
    }
  }
  return updates.slice(0, 8)
}

async function getCurrentVersion(): Promise<string> {
  if (!isTauriRuntime()) return '0.0.0'
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}

export async function checkForUpdates(silent: boolean) {
  if (!isTauriRuntime()) return

  const store = useUpdateStore.getState()
  store.setStatus({ kind: 'checking' })

  try {
    const currentVersion = await getCurrentVersion()
    const isPrerelease = currentVersion.includes('-')
    const apiUrl = isPrerelease
      ? `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=5`
      : `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

    const resp = await fetch(apiUrl)
    if (!resp.ok) throw new Error('获取更新信息失败')
    const payload = (await resp.json()) as GithubRelease | GithubRelease[]
    const data = Array.isArray(payload) ? payload.find((r) => !r.draft) : payload
    if (!data) throw new Error('未找到可用的发布版本')

    const latestVersion = data.tag_name.replace(/^v/, '')

    if (compareVersions(latestVersion, currentVersion) > 0) {
      const setupAsset = (data.assets ?? []).find(
        (a) => a.name.endsWith('_setup.exe') || a.name.endsWith('-setup.exe'),
      )
      store.showDialog({
        currentVersion,
        latestVersion,
        notes: extractKeyUpdates(data.body),
        downloadUrl: setupAsset?.browser_download_url ?? null,
        releaseUrl: data.html_url,
      })
    } else if (!silent) {
      store.setStatus({ kind: 'latest', message: '已是最新版本' })
    } else {
      store.setStatus({ kind: 'idle' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    store.setStatus({ kind: 'error', message: '检查更新失败：' + message })
  }
}
