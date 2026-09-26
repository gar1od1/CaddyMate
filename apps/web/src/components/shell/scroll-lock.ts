/**
 * Body scroll lock for modal overlays (the phone nav drawer, the table filter
 * sheet). Uses the position-fixed technique because iOS Safari ignores
 * `overflow: hidden` on body. Nested locks are counted.
 */
let locks = 0;
let savedY = 0;

export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (locks++ === 0) {
    savedY = window.scrollY;
    const s = document.body.style;
    s.position = 'fixed';
    s.top = `-${String(savedY)}px`;
    s.left = '0';
    s.right = '0';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      const s = document.body.style;
      s.position = '';
      s.top = '';
      s.left = '';
      s.right = '';
      window.scrollTo(0, savedY);
    }
  };
}
