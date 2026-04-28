declare module 'shpjs' {
  import type { FeatureCollection, GeoJsonObject } from 'geojson'
  type ShpInput = ArrayBuffer | string | Blob
  function shp(
    input: ShpInput,
  ): Promise<FeatureCollection | FeatureCollection[] | GeoJsonObject>
  export default shp
}
