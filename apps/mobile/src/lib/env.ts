/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined at build
 * time. Nothing here throws at import (CI exports run without a .env); the
 * root layout shows `envProblem` instead of the app when config is missing.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
};

export const envProblem: string | null =
  !supabaseUrl || !supabaseAnonKey
    ? 'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy apps/mobile/.env.example to .env and fill it in.'
    : null;
