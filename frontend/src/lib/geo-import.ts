import type { GeoJsonObject } from 'geojson'
import shp from 'shpjs'
import JSZip from 'jszip'
import { kml as kmlToGeoJson } from '@tmcw/togeojson'

const SUPPORTED_EXTENSIONS = ['.geojson', '.json', '.shp', '.zip', '.kml', '.kmz'] as const

export const SUPPORTED_REGION_FILE_EXTENSIONS: ReadonlyArray<string> = SUPPORTED_EXTENSIONS
export const REGION_FILE_ACCEPT_ATTR = SUPPORTED_EXTENSIONS.join(',')
export const REGION_FILE_FILTER_LABEL = '区域文件 (GeoJSON / Shapefile / KML / KMZ)'

export class UnsupportedRegionFileError extends Error {
  constructor(filename: string) {
    super(
      `不支持的格式：${filename}。仅支持 ${SUPPORTED_EXTENSIONS.join(' / ')}`,
    )
    this.name = 'UnsupportedRegionFileError'
  }
}

function parseKmlText(text: string): GeoJsonObject {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const errNode = doc.querySelector('parsererror')
  if (errNode) {
    throw new Error('KML XML 解析失败')
  }
  return kmlToGeoJson(doc) as unknown as GeoJsonObject
}

async function parseKmzBuffer(buf: ArrayBuffer): Promise<GeoJsonObject> {
  const zip = await JSZip.loadAsync(buf)
  // 优先 doc.kml；否则取首个 .kml
  const direct = zip.file(/^doc\.kml$/i)?.[0] ?? zip.file(/\.kml$/i)?.[0]
  if (!direct) {
    throw new Error('KMZ 中未找到 .kml 文件')
  }
  const text = await direct.async('text')
  return parseKmlText(text)
}

/**
 * 统一读取区域文件（GeoJSON / Shapefile zip / .shp / KML / KMZ），返回 GeoJSON 对象。
 * 不做空几何校验，调用方负责后续校验与提取。
 */
export async function parseRegionFile(file: File): Promise<GeoJsonObject> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    const text = await file.text()
    return JSON.parse(text) as GeoJsonObject
  }
  if (name.endsWith('.zip') || name.endsWith('.shp')) {
    const buf = await file.arrayBuffer()
    return (await shp(buf)) as GeoJsonObject
  }
  if (name.endsWith('.kml')) {
    const text = await file.text()
    return parseKmlText(text)
  }
  if (name.endsWith('.kmz')) {
    const buf = await file.arrayBuffer()
    return await parseKmzBuffer(buf)
  }
  throw new UnsupportedRegionFileError(file.name)
}
