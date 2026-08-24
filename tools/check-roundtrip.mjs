// Two isolated browsers, two anonymous accounts, one conversation. Proves the
// parts that only fail with a real server: add-by-code, the RLS policies, and
// realtime delivery to the other side.
//
//   node tools/check-roundtrip.mjs        (needs npm run dev, and a live backend)
//
// This writes real rows. See the cleanup SQL printed at the end.
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5173/'
const fails = []
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails.push(m) }

const browser = await chromium.launch()

// separate contexts => separate storage => two different anonymous accounts
const [alice, bob] = await Promise.all([browser.newContext(), browser.newContext()])
const [a, b] = await Promise.all([alice.newPage(), bob.newPage()])

for (const p of [a, b]) {
  await p.goto(URL, { waitUntil: 'networkidle' })
}
await a.waitForTimeout(3000)

const codeOf = (p) => p.evaluate(async () => (await window.backend.me())?.code ?? null)
const [aCode, bCode] = await Promise.all([codeOf(a), codeOf(b)])

console.log(`alice ${aCode}\nbob   ${bCode}\n`)
ok(!!aCode && !!bCode, 'both sides signed in and got a code')
ok(aCode !== bCode, 'the two accounts are distinct')

if (!aCode || !bCode) {
  console.log('\ncannot continue without two sessions')
  await browser.close()
  process.exit(1)
}

// Bob listens before Alice sends, so this is genuine realtime, not a re-fetch.
await b.evaluate(() => {
  window.__inbox = []
  window.backend.subscribe((e) => { if (e.type === 'message') window.__inbox.push(e.message.body) })
})

// Alice cannot see Bob before they are friends.
const leaked = await a.evaluate(async () => (await window.backend.friends()).length)
ok(leaked === 0, `alice starts with no friends (${leaked})`)

const added = await a.evaluate(async (code) => {
  try { return { ok: true, friend: await window.backend.addFriend(code) } }
  catch (e) { return { ok: false, error: e.message } }
}, bCode)
ok(added.ok, `alice adds bob by code${added.ok ? '' : ': ' + added.error}`)

// A wrong code must be refused, not silently accepted.
const bogus = await a.evaluate(async () => {
  try { await window.backend.addFriend('ZZZZ-ZZZZ'); return 'accepted' }
  catch (e) { return e.message }
})
ok(bogus !== 'accepted', `an unknown code is refused (${bogus})`)

if (added.ok) {
  const body = 'roundtrip ' + Math.floor(performance.now())
  const t0 = Date.now()
  await a.evaluate(async ({ id, body }) => window.backend.send(id, body), { id: added.friend.id, body })

  await b.waitForFunction((sent) => window.__inbox?.includes(sent), body, { timeout: 15000 }).catch(() => {})
  const ms = Date.now() - t0
  const got = await b.evaluate(() => window.__inbox ?? [])
  ok(got.includes(body), `bob receives it over realtime (${ms}ms)`)

  // Both sides must now read the same conversation.
  const seen = await b.evaluate(async () => {
    const fs = await window.backend.friends()
    if (!fs.length) return { friends: 0, msgs: [] }
    return { friends: fs.length, unread: fs[0].unread, msgs: (await window.backend.messages(fs[0].id)).map((m) => m.body) }
  })
  ok(seen.friends === 1, `bob sees alice in his friend list (${seen.friends})`)
  ok(seen.msgs?.includes(body), 'bob can read the message back from the database')
  ok(seen.unread >= 1, `bob has an unread count (${seen.unread})`)
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nround trip works')
console.log(`\nto remove the two test accounts:\n  delete from auth.users where id in (\n    select id from public.profiles where code in ('${aCode}', '${bCode}')\n  );`)

await browser.close()
process.exit(fails.length ? 1 : 0)
