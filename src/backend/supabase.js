// Real backend. Same surface as mock.js, so nothing else in the app changes.
//
// Identity is an anonymous Supabase auth user created on first launch and kept
// in localStorage. No login screen, but it also means clearing site data loses
// your friend code — see README.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

const listeners = new Set()
function emit(evt) { for (const fn of listeners) fn(evt) }

let me = null
let channel = null

// The UI speaks {id, from: 'me' | friendId, body, ts}; the table speaks rows.
function toMessage(row) {
  return {
    id: row.id,
    from: row.sender_id === me.id ? 'me' : row.sender_id,
    body: row.body,
    ts: new Date(row.created_at).getTime(),
  }
}

function fail(error, fallback) {
  if (!error) return
  throw new Error(error.message || fallback)
}

export const supabaseBackend = {
  name: 'supabase',

  async init() {
    const { data: { session } } = await client.auth.getSession()
    if (!session) {
      const { error } = await client.auth.signInAnonymously()
      if (error) {
        throw new Error(
          error.message.includes('disabled')
            ? 'Anonymous sign-ins are off. Enable them in Supabase > Authentication > Providers.'
            : error.message
        )
      }
    }

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('could not establish a session')

    // The profile row is created by a trigger; on a brand new account it can
    // land a beat after the user does.
    let profile = null
    for (let attempt = 0; attempt < 5 && !profile; attempt++) {
      const { data } = await client.from('profiles').select('id, code, display_name').eq('id', user.id).maybeSingle()
      profile = data
      if (!profile) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
    if (!profile) throw new Error('profile was not created — did the migration run?')

    me = { id: profile.id, code: profile.code, name: profile.display_name }

    // One subscription for everything addressed to me.
    channel = client
      .channel('inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${me.id}` },
        (payload) => {
          const row = payload.new
          emit({ type: 'message', friendId: row.sender_id, message: toMessage(row) })
          emit({ type: 'friends' })
        }
      )
      .subscribe()

    client.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {})
    return me
  },

  async me() { return me },

  async friends() {
    const { data, error } = await client.rpc('my_friends')
    fail(error, 'could not load friends')
    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.display_name,
      code: r.code,
      unread: Number(r.unread ?? 0),
    }))
  },

  async messages(friendId) {
    const { data, error } = await client
      .from('messages')
      .select('id, sender_id, recipient_id, body, created_at')
      .or(
        `and(sender_id.eq.${me.id},recipient_id.eq.${friendId}),` +
        `and(sender_id.eq.${friendId},recipient_id.eq.${me.id})`
      )
      .order('created_at', { ascending: true })
      .limit(200)
    fail(error, 'could not load messages')
    return (data ?? []).map(toMessage)
  },

  async addFriend(code) {
    const clean = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) throw new Error('that code looks wrong')
    const { data, error } = await client.rpc('add_friend', { friend_code: clean })
    fail(error, 'could not add that friend')
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('no one has that code')
    emit({ type: 'friends' })
    return { id: row.id, name: row.display_name, code: row.code, unread: 0 }
  },

  async send(friendId, body) {
    const { data, error } = await client
      .from('messages')
      .insert({ sender_id: me.id, recipient_id: friendId, body })
      .select('id, sender_id, recipient_id, body, created_at')
      .single()
    fail(error, 'message did not send')
    const msg = toMessage(data)
    emit({ type: 'message', friendId, message: msg })
    return msg
  },

  async markRead(friendId) {
    if (!friendId) return
    const { error } = await client
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId)
      .eq('recipient_id', me.id)
      .is('read_at', null)
    fail(error, 'could not mark read')
    emit({ type: 'friends' })
  },

  // Unread lives in the database, so there is nothing to bump locally — the
  // caller re-reads friends() right after this.
  async bumpUnread() {},

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },

  async signOut() {
    if (channel) await client.removeChannel(channel)
    await client.auth.signOut()
  },
}
