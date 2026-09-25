import type { LatLng } from '@caddymate/engine';
import { colors } from '@caddymate/ui';
import {
  Camera,
  Map,
  UserLocation,
  type CameraStop,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import { StyleSheet } from 'react-native';
import { env } from '@/lib/env';

/**
 * Satellite basemap. Mapbox when a token is configured (best imagery of Irish
 * courses), otherwise ESRI World Imagery which needs no key.
 */
function satelliteStyle(): StyleSpecification {
  const tiles = env.mapboxToken
    ? [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${env.mapboxToken}`,
      ]
    : [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ];
  return {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution: env.mapboxToken ? '© Mapbox' : 'Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': colors.bg } },
      { id: 'satellite', type: 'raster', source: 'satellite' },
    ],
  };
}

const STYLE = satelliteStyle();

interface Props {
  /** Simple centred view (used when no camera stop is given). */
  center?: LatLng;
  zoom?: number;
  bearing?: number;
  /** Controlled camera (e.g. fit a hole's bounds, rotated to the line of play). */
  camera?: CameraStop;
  onPress?: (p: LatLng) => void;
  children?: React.ReactNode;
}

export function CourseMap({ center, zoom = 16, bearing = 0, camera, onPress, children }: Props) {
  return (
    <Map
      style={styles.map}
      mapStyle={STYLE}
      logo={false}
      attribution
      compass={false}
      touchPitch={false}
      onPress={
        onPress
          ? (e) => {
              const [lng, lat] = e.nativeEvent.lngLat;
              onPress({ lat, lng });
            }
          : undefined
      }
    >
      {camera ? (
        <Camera {...camera} />
      ) : (
        <Camera
          initialViewState={{ zoom, bearing }}
          center={center ? [center.lng, center.lat] : undefined}
        />
      )}
      <UserLocation accuracy heading />
      {children}
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
