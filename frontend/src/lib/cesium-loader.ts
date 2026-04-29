// Cesium CDN 懒加载（与旧版 static 保持一致，避免 bundle 体积爆炸）
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Cesium?: any
  }
}

const CESIUM_VERSION = '1.140.0'
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium`

let loadingPromise: Promise<unknown> | null = null

export function loadCesium(): Promise<unknown> {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (loadingPromise) return loadingPromise

  loadingPromise = new Promise((resolve, reject) => {
    // CSS
    const cssId = 'cesium-widgets-css'
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link')
      link.id = cssId
      link.rel = 'stylesheet'
      link.href = `${CESIUM_BASE}/Widgets/widgets.css`
      document.head.appendChild(link)
    }

    // 设置 CESIUM_BASE_URL 给 worker/asset 解析
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).CESIUM_BASE_URL = `${CESIUM_BASE}/`

    const scriptId = 'cesium-js-script'
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Cesium))
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.id = scriptId
    script.src = `${CESIUM_BASE}/Cesium.js`
    script.async = true
    script.onload = () => {
      if (window.Cesium) resolve(window.Cesium)
      else reject(new Error('Cesium 加载完成但全局对象不存在'))
    }
    script.onerror = (e) => reject(e)
    document.head.appendChild(script)
  })

  return loadingPromise
}
