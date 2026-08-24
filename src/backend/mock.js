// Fake backend so the whole UI is exercisable in a browser with no server.
// Mirrors the exact surface the Supabase adapter will expose.

const KEY = 'dchat.mock.v2'
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ' // no look-alikes

function newCode() {
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (i === 3) out += '-'
  }
  return out
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  // Starts empty. This backend only runs when no Supabase key is configured,
  // and inventing friends made it easy to mistake it for a working connection.
  const seed = { me: { code: newCode(), name: 'you' }, friends: [], messages: {} }
  save(seed)
  return seed
}

function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch {}
}

let db = load()
const listeners = new Set()
let seq = 100

function emit(evt) { for (const fn of listeners) fn(evt) }

export const mockBackend = {
  name: 'mock',

  async init() { return db.me },

  async me() { return db.me },

  async friends() { return db.friends },

  async messages(friendId) { return db.messages[friendId] ?? [] },

  async addFriend(code) {
    const clean = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) throw new Error('that code looks wrong')
    if (clean === db.me.code) throw new Error("that's your own code")
    if (db.friends.some((f) => f.code === clean)) throw new Error('already added')
    const friend = { id: 'f' + ++seq, name: 'friend ' + clean.slice(0, 4), code: clean, unread: 0 }
    db.friends.push(friend)
    db.messages[friend.id] = []
    save(db)
    emit({ type: 'friends' })
    return friend
  },

  async send(friendId, body) {
    const msg = { id: ++seq, from: 'me', body, ts: Date.now() }
    ;(db.messages[friendId] ??= []).push(msg)
    save(db)
    emit({ type: 'message', friendId, message: msg })
    return msg
  },

  // Test hook: simulates an inbound message so the unread bubble can be seen.
  _receive(friendId, body) {
    const msg = { id: ++seq, from: friendId, body, ts: Date.now() }
    ;(db.messages[friendId] ??= []).push(msg)
    save(db)
    emit({ type: 'message', friendId, message: msg })
  },

  async markRead(friendId) {
    const f = db.friends.find((x) => x.id === friendId)
    if (f && f.unread) { f.unread = 0; save(db); emit({ type: 'friends' }) }
  },

  async bumpUnread(friendId) {
    const f = db.friends.find((x) => x.id === friendId)
    if (f) { f.unread = (f.unread ?? 0) + 1; save(db); emit({ type: 'friends' }) }
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },

  reset() { localStorage.removeItem(KEY); db = load(); emit({ type: 'friends' }) },
}
