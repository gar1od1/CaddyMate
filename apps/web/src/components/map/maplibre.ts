import type * as Maplibre from 'maplibre-gl';

export type MaplibreModule = typeof Maplibre;
export type MaplibreMap = Maplibre.Map;

/** ESRI World Imagery — the satellite base for every course map. */
export const ESRI_WORLD_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const SATELLITE_STYLE: Maplibre.MapOptions['style'] = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [ESRI_WORLD_IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
};

/** Served by src/app/courses/maplibre/[file]/route.ts. */
const WORKER_URL = '/courses/maplibre/maplibre-gl-worker.mjs';

let loading: Promise<MaplibreModule> | null = null;

/** maplibre-gl touches `window` at import time, so load it lazily on the client. */
export function loadMaplibre(): Promise<MaplibreModule> {
  loading ??= import('maplibre-gl').then((ml) => {
    ml.setWorkerUrl(WORKER_URL);
    return ml;
  });
  return loading;
}
