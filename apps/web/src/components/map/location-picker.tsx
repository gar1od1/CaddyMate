'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Marker } from 'maplibre-gl';
import { SatelliteMap } from './satellite-map';
import type { MaplibreMap, MaplibreModule } from './maplibre';

export interface LatLngValue {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface Props {
  value: LatLngValue | null;
  onChange: (p: LatLngValue) => void;
  /** Reports the visible area (used as the OSM import bbox). */
  onBoundsChange?: (b: Bounds) => void;
  className?: string;
}

const DEFAULT_CENTRE: LatLngValue = { lat: 53.4245, lng: -6.9165 }; // Moyvalley

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Click the satellite map to choose a point; the pin follows `value`. */
export function LocationPicker({ value, onChange, onBoundsChange, className }: Props) {
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const mlRef = useRef<MaplibreModule | null>(null);
  const cbs = useRef({ onChange, onBoundsChange });
  const firstValue = useRef(value);

  useEffect(() => {
    cbs.current = { onChange, onBoundsChange };
  }, [onChange, onBoundsChange]);

  const syncMarker = useCallback((p: LatLngValue | null) => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    if (!p) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    markerRef.current ??= new ml.Marker({ color: '#3ddc84' }).setLngLat([p.lng, p.lat]).addTo(map);
    markerRef.current.setLngLat([p.lng, p.lat]);
  }, []);

  useEffect(() => {
    syncMarker(value);
    if (value && mapRef.current && !mapRef.current.getBounds().contains([value.lng, value.lat])) {
      mapRef.current.easeTo({ center: [value.lng, value.lat] });
    }
  }, [value, syncMarker]);

  const onLoad = useCallback(
    (map: MaplibreMap, ml: MaplibreModule) => {
      mapRef.current = map;
      mlRef.current = ml;
      syncMarker(firstValue.current);
      const report = () => {
        const b = map.getBounds();
        cbs.current.onBoundsChange?.({
          south: round(b.getSouth()),
          west: round(b.getWest()),
          north: round(b.getNorth()),
          east: round(b.getEast()),
        });
      };
      map.on('moveend', report);
      report();
      map.on('click', (e) =>
        cbs.current.onChange({ lat: round(e.lngLat.lat), lng: round(e.lngLat.lng) }),
      );
      map.getCanvas().style.cursor = 'crosshair';
    },
    [syncMarker],
  );

  return (
    <SatelliteMap
      center={value ?? DEFAULT_CENTRE}
      zoom={value ? 15 : 14}
      className={className}
      onLoad={onLoad}
    />
  );
}
