export type Nullable<T> = T | null

export type OutputFormat = 'geotiff' | 'tiles' | 'mbtiles' | 'gpkg' | string

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

export type Position = [number, number]
export type Polygon = Position[] | Position[][] | Record<string, unknown>

export interface TileSource {
  id?: string
  key?: string
  name: string
  url?: string
  url_template?: string
  type?: string
  max_zoom?: number
  min_zoom?: number
  subdomains?: string[]
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface AppSettings {
  tianditu_token?: Nullable<string>
  proxy_enabled?: boolean
  proxy_url?: Nullable<string>
  default_concurrency?: number
  default_zoom?: number
  default_format?: OutputFormat
  default_source?: string
  memory_budget_mb?: number
  custom_sources?: Record<string, TileSource>
  builtin_sources?: Record<string, TileSource>
  [key: string]: unknown
}

export interface SystemMemoryInfo {
  total_mb: number
  available_mb: number
  recommended_budget_mb?: number
  [key: string]: unknown
}

export interface DownloadRequest {
  bounds: Bounds
  zoom: number
  zoom_max?: Nullable<number>
  source: string
  format: OutputFormat
  save_path?: Nullable<string>
  concurrency?: number
  proxy?: Nullable<string>
  polygon?: Nullable<Polygon>
  crop_to_shape?: boolean
  source_name?: string
  tianditu_token?: Nullable<string>
  [key: string]: unknown
}

export interface DownloadEstimate {
  tile_count: number
  estimated_size_mb?: number
  estimated_size?: string
  zoom?: number
  zoom_max?: Nullable<number>
  levels?: Array<{ zoom: number; tile_count: number; estimated_size_mb?: number }>
  [key: string]: unknown
}

export interface DownloadResult {
  success: boolean
  file_path?: string
  file_size?: number
  tile_count?: number
  failed_count?: number
  task_id?: string
  [key: string]: unknown
}

export interface TileProbeResult {
  has_data: boolean
  status_code?: number
  content_length?: number
  message?: string
  [key: string]: unknown
}

export interface TaskInfo {
  id: string
  name?: string
  status: string
  progress?: number
  completed?: number
  total?: number
  message?: string
  [key: string]: unknown
}

export interface TaskProgressPayload extends TaskInfo {
  task_id: string
}

export interface DownloadHistoryRecord {
  id: string | number
  name: string
  source?: string
  source_name?: string
  zoom?: number
  format?: OutputFormat
  file_path?: string
  file_size?: number
  tile_count?: number
  failed_count?: number
  success?: boolean
  created_at?: string
  [key: string]: unknown
}

export interface AdminDivision {
  code: string
  name: string
  [key: string]: unknown
}

export interface WaybackVersion {
  id?: string
  version_id?: string
  name?: string
  date?: string
  release_date?: string
  [key: string]: unknown
}

export interface WaybackScanRequest {
  bounds: Bounds
  zoom_min?: number
  zoom_max?: number
  start_date?: Nullable<string>
  end_date?: Nullable<string>
  release_ids?: string[]
  scan_mode?: 'fast' | 'fine' | string
  proxy?: Nullable<string>
  force_refresh?: boolean
  [key: string]: unknown
}

export interface WaybackScanProgress {
  scan_id: string
  status: string
  progress: number
  message?: string
  result?: unknown
  [key: string]: unknown
}

export interface WaybackIncrementalRequest {
  scan_id?: string
  groups?: unknown[]
  output_dir?: string
  format?: OutputFormat
  [key: string]: unknown
}

export interface Tiles3dSource {
  url?: string
  path?: string
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface Tiles3dTaskRequest {
  source: Tiles3dSource
  output_dir?: string
  polygon?: Nullable<Polygon>
  proxy?: Nullable<string>
  [key: string]: unknown
}
