/**
 * RFC 4122 v4 UUID. Uses Web Crypto when the runtime has it (web, Deno, Node,
 * recent Hermes), else Math.random — ids only need to be unique per user, not
 * unguessable (RLS guards access).
 */
export function uuidv4(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex.charAt(8 + Math.floor(Math.random() * 4));
    else out += hex.charAt(Math.floor(Math.random() * 16));
  }
  return out;
}
