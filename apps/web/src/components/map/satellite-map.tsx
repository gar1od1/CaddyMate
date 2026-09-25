'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { loadMaplibre, SATELLITE_STYLE, type MaplibreMap, type MaplibreModule } from './maplibre';

export interface SatelliteMapProps {
  /** Initial camera; later changes are ignored (drive the map through onLoad's instance). */
  center: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  /** Called once the style has loaded. */
  onLoad?: (map: MaplibreMap, ml: MaplibreModule) => void;
}

/** A MapLibre map on ESRI World Imagery. Owns the map's lifetime. */
export function SatelliteMap({ center, zoom = 15, className, onLoad }: SatelliteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  const initial = useRef({ center, zoom });

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    let map: MaplibreMap | null = null;
    let cancelled = false;
    void loadMaplibre().then((ml) => {
      if (cancelled || !container.current) return;
      const { center: c, zoom: z } = initial.current;
      const m = new ml.Map({
        container: container.current,
        style: SATELLITE_STYLE,
        center: [c.lng, c.lat],
        zoom: z,
        maxZoom: 20,
        attributionControl: { compact: true },
      });
      map = m;
      m.addControl(new ml.NavigationControl({ visualizePitch: false }), 'top-right');
      m.addControl(new ml.ScaleControl({ unit: 'imperial' }), 'bottom-left');
      m.on('load', () => onLoadRef.current?.(m, ml));
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  // maplibre-gl.css makes the map element position:relative, so size an outer box.
  return (
    <div className={className}>
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
