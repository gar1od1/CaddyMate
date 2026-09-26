/**
 * mapbox-gl-draw modes with snapping (docs/SPEC.md §13). mapbox-gl-draw has
 * no snapping of its own, so these wrap the built-in `draw_polygon`,
 * `draw_line_string` and `direct_select` modes and pass every placed or
 * dragged vertex through `snap` (lib/courses/snap.ts via editor-map.tsx)
 * before the stock logic sees it. Registered under the stock names, so
 * `changeMode('draw_polygon')` etc. get the snapping versions.
 *
 * Only the geometry in the draw tool changes: snapping to a neighbour's edge
 * puts this shape's vertex on that edge and leaves the neighbour untouched.
 */

export interface LngLatLike {
  lng: number;
  lat: number;
}

/** The parts of a mapbox-gl-draw mode event these wrappers use. */
interface DrawEvent {
  lngLat: LngLatLike;
  originalEvent?: { altKey?: boolean };
}

/** Returns the (possibly snapped) position for a cursor position; null clears the cue. */
export type Snapper = (lngLat: LngLatLike | null, e?: DrawEvent) => LngLatLike;

type Handler = (this: ModeThis, state: ModeState, e: DrawEvent, ...rest: unknown[]) => unknown;
type ModeThis = Record<string, Handler>;
interface ModeState {
  selectedCoordPaths?: string[];
  feature?: { updateCoordinate(path: string, lng: number, lat: number): void };
}
export type DrawMode = Record<string, unknown>;

/** A copy of the event whose `lngLat` is replaced (other fields read through). */
function withLngLat<E extends DrawEvent>(e: E, lngLat: LngLatLike): E {
  return Object.assign(Object.create(e) as E, { lngLat });
}

/** Wrap a draw mode's `clickAnywhere` and `onMouseMove` so placed vertices snap. */
function snappingCreateMode(base: DrawMode, snap: Snapper): DrawMode {
  const click = base.clickAnywhere as Handler;
  const move = base.onMouseMove as Handler;
  const stop = base.onStop as Handler;
  return {
    ...base,
    clickAnywhere(this: ModeThis, state: ModeState, e: DrawEvent) {
      return click.call(this, state, withLngLat(e, snap(e.lngLat, e)));
    },
    onMouseMove(this: ModeThis, state: ModeState, e: DrawEvent) {
      return move.call(this, state, withLngLat(e, snap(e.lngLat, e)));
    },
    onStop(this: ModeThis, state: ModeState, e: DrawEvent) {
      snap(null);
      return stop.call(this, state, e);
    },
  };
}

/** Wrap `direct_select` so a single dragged vertex (or new midpoint vertex) snaps. */
function snappingDirectSelect(base: DrawMode, snap: Snapper): DrawMode {
  const dragVertex = base.dragVertex as Handler;
  const stopDragging = base.stopDragging as Handler;
  const stop = base.onStop as Handler;
  return {
    ...base,
    dragVertex(this: ModeThis, state: ModeState, e: DrawEvent, delta: unknown) {
      const paths = state.selectedCoordPaths ?? [];
      // Moving several vertices together keeps their shape: no snapping.
      if (paths.length !== 1 || !state.feature) return dragVertex.call(this, state, e, delta);
      // The vertex follows the cursor (not cursor + grab offset, which is at most
      // the click buffer) so a snapped position is exact.
      const p = snap(e.lngLat, e);
      state.feature.updateCoordinate(paths[0]!, p.lng, p.lat);
      return undefined;
    },
    stopDragging(this: ModeThis, state: ModeState, e: DrawEvent) {
      snap(null);
      return stopDragging.call(this, state, e);
    },
    onStop(this: ModeThis, state: ModeState, e: DrawEvent) {
      snap(null);
      return stop.call(this, state, e);
    },
  };
}

/** The stock modes with the three drawing/editing ones replaced by snapping versions. */
export function snappingModes(stock: Record<string, DrawMode>, snap: Snapper) {
  return {
    ...stock,
    draw_polygon: snappingCreateMode(stock.draw_polygon!, snap),
    draw_line_string: snappingCreateMode(stock.draw_line_string!, snap),
    direct_select: snappingDirectSelect(stock.direct_select!, snap),
  };
}
