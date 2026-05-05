import { useEffect, useState } from 'react'

import { QR_ASSETS, type QrKey } from '@/lib/qr-assets'

/**
 * 远程静态资源（二维码等）本地缓存。
 *
 * 背景：原本 <img src={remote} /> 每次对话框打开都会重新请求 GitHub Releases，
 * 一是慢（境内用户），二是 release 资产 302 重定向后缓存策略不稳定。
 *
 * 策略：
 *   1. 先返回本地兜底图，立即可见；
 *   2. 命中 localStorage 缓存则升级为 dataURL；
 *   3. 缓存缺失或过期时后台 fetch 远程，成功后写入 localStorage，并实时更新 src；
 *   4. 远程失败保持本地兜底图。
 *
 * 缓存条目体积：单图 ~50KB，base64 后 ~70KB，全部 4 张 < 300KB，远低于 localStorage 5MB 上限。
 */

const CACHE_PREFIX = 'gd:img:'
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000 // 7 天

interface CacheEntry {
  dataUrl: string
  fetchedAt: number
}

function readCache(key: QrKey): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (!entry?.dataUrl || typeof entry.fetchedAt !== 'number') return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null
    return entry
  } catch {
    return null
  }
}

function writeCache(key: QrKey, dataUrl: string) {
  try {
    const entry: CacheEntry = { dataUrl, fetchedAt: Date.now() }
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // 容量满 / 隐私模式：忽略
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const inflight = new Map<QrKey, Promise<string | null>>()

async function fetchAndCache(key: QrKey, remote: string): Promise<string | null> {
  if (inflight.has(key)) return inflight.get(key)!
  const task = (async () => {
    try {
      const res = await fetch(remote, { cache: 'no-store' })
      if (!res.ok) return null
      const blob = await res.blob()
      const dataUrl = await blobToDataUrl(blob)
      writeCache(key, dataUrl)
      return dataUrl
    } catch {
      return null
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, task)
  return task
}

/**
 * 返回当前可用的图片 src。
 * 初始为命中缓存的 dataURL；缓存缺失时返回本地兜底图，并在后台拉远程。
 */
export function useCachedImage(key: QrKey): string {
  const asset = QR_ASSETS[key]
  const [src, setSrc] = useState<string>(() => {
    const cached = readCache(key)
    return cached ? cached.dataUrl : asset.local
  })

  useEffect(() => {
    let cancelled = false
    const cached = readCache(key)
    if (cached) return
    fetchAndCache(key, asset.remote).then((dataUrl) => {
      if (cancelled) return
      if (dataUrl) setSrc(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [key, asset.remote])

  return src
}
