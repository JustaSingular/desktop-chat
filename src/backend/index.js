// Single place that decides which backend the app talks to.
import { HAS_SUPABASE } from '../config.js'
import { mockBackend } from './mock.js'

export const backend = HAS_SUPABASE
  ? (await import('./supabase.js')).supabaseBackend
  : mockBackend

// Handy in the console: backend._receive('sam', 'hi') on mock to test unreads.
if (typeof window !== 'undefined') window.backend = backend
