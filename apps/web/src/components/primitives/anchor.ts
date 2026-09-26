/**
 * Where a popover anchored to an element opens (the Select listbox, the
 * table filter panel). Pure so it is unit-tested; the components measure and
 * pass rectangles in. Kept inside the viewport with an 8px margin: below the
 * anchor when it fits, otherwise on whichever side has more room.
 */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
  side: 'below' | 'above';
}

const MARGIN = 8;
const GAP = 4;

export function placePopover(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'start' | 'end' = 'start',
): Placement {
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const side = size.height <= below || below >= above ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);
  const wanted = align === 'end' ? anchor.right - size.width : anchor.left;
  const left = Math.max(MARGIN, Math.min(wanted, viewport.width - size.width - MARGIN));
  return side === 'below'
    ? { top: anchor.bottom + GAP, left, maxHeight: room, side }
    : { bottom: viewport.height - anchor.top + GAP, left, maxHeight: room, side };
}
