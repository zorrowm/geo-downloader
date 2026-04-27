import { invokeCommand } from '@/lib/tauri'
import type { AdminDivision } from '@/types/api'

export function getProvinces() {
  return invokeCommand<AdminDivision[]>('get_provinces')
}

export function getCities(provinceCode: string) {
  return invokeCommand<AdminDivision[]>('get_cities', { provinceCode })
}

export function getDistricts(cityCode: string) {
  return invokeCommand<AdminDivision[]>('get_districts', { cityCode })
}

export function getAdminBoundary(code: string, toWgs84 = true) {
  return invokeCommand<Record<string, unknown>>('get_admin_boundary', { code, toWgs84 })
}

export function geocodeSearch(query: string, tiandituToken: string | null) {
  return invokeCommand<unknown[]>('geocode_search', { query, tiandituToken: tiandituToken || null })
}

export function downloadAdminBoundaryFile(code: string, savePath: string) {
  return invokeCommand<void>('download_admin_boundary_file', { code, savePath })
}
