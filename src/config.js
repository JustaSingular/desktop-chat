// Build-time config. Vite inlines these into the bundle.
//
// The anon key is designed to be public — it is safe to ship inside the app
// your friends install, because every table is locked down by RLS. The
// service_role key is NOT safe and must never appear in this project.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// No key yet => the app falls back to the local mock backend, so the UI still runs.
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
