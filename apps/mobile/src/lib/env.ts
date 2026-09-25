/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined at build
 * time; missing values fail fast with a readable message instead of a
 * confusing network error later.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy apps/mobile/.env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
};
