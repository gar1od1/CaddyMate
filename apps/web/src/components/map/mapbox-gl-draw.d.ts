// Minimal typings for the parts of @mapbox/mapbox-gl-draw the course editor
// uses (the package ships no types; @types/mapbox__mapbox-gl-draw pulls in
// mapbox-gl). It works with maplibre-gl once the CSS class constants are
// pointed at the maplibregl-* names (see components/course-editor/draw.ts).
declare module '@mapbox/mapbox-gl-draw' {
  import type { Feature, FeatureCollection, Geometry } from 'geojson';

  export interface DrawOptions {
    displayControlsDefault?: boolean;
    controls?: Record<string, boolean>;
    styles?: object[];
    keybindings?: boolean;
    touchEnabled?: boolean;
    boxSelect?: boolean;
    clickBuffer?: number;
    touchBuffer?: number;
    defaultMode?: string;
  }

  export default class MapboxDraw {
    constructor(options?: DrawOptions);
    static constants: { classes: Record<string, string> };
    onAdd(map: unknown): HTMLElement;
    onRemove(map: unknown): void;
    add(geojson: Feature | FeatureCollection | Geometry): string[];
    get(id: string): Feature | undefined;
    getAll(): FeatureCollection;
    delete(ids: string | string[]): this;
    deleteAll(): this;
    changeMode(mode: string, options?: object): this;
    getMode(): string;
    trash(): this;
  }
}
