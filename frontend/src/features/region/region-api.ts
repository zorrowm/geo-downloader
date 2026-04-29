import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntime } from '@/lib/tauri'

export interface AdminRegion {
  code: string
  name: string
}

export interface GeocodeResult {
  name: string
  display_name: string
  lat: number
  lng: number
  bounds?: { north: number; south: number; east: number; west: number } | null
  /** 'admin' 或 'poi' */
  kind?: string
  admin_code?: string | null
  address?: unknown
}

function ensureTauri() {
  if (!isTauriRuntime()) {
    throw new Error('当前运行环境不支持 Tauri API')
  }
}

export async function getProvinces(): Promise<AdminRegion[]> {
  ensureTauri()
  return invoke<AdminRegion[]>('get_provinces')
}

export async function getCities(provinceCode: string): Promise<AdminRegion[]> {
  ensureTauri()
  return invoke<AdminRegion[]>('get_cities', { provinceCode })
}

export async function getDistricts(cityCode: string): Promise<AdminRegion[]> {
  ensureTauri()
  return invoke<AdminRegion[]>('get_districts', { cityCode })
}

export async function getAdminBoundary(code: string, toWgs84 = true): Promise<unknown> {
  ensureTauri()
  return invoke<unknown>('get_admin_boundary', { code, toWgs84 })
}

export async function geocodeSearch(
  query: string,
  tiandituToken: string | null = null,
): Promise<GeocodeResult[]> {
  ensureTauri()
  return invoke<GeocodeResult[]>('geocode_search', { query, tiandituToken })
}
