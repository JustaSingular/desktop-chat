// Single place that decides which backend the app talks to.
import { HAS_SUPABASE } from '../config.js'
import { mockBackend } from './mock.js'

// ?backend=mock forces the offline backend even when a key is configured. The
// UI tests use it so they stay deterministic and never write to the real
// database; check-backend.mjs and check-roundtrip.mjs exercise the real one.
const forceMock =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('backend') === 'mock'

export const backend = HAS_SUPABASE && !forceMock
  ? (await import('./supabase.js')).supabaseBackend
  : mockBackend

// Handy in the console: backend._receive('<id>', 'hi') on mock to test unreads.
if (typeof window !== 'undefined') window.backend = backend
