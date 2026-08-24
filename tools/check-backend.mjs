// Reports which backend the running app is actually talking to, and whether it
// got a session and a profile. Catches the three things that go wrong when
// wiring Supabase up: key missing, migration not run, anonymous sign-ins off.
//
//   node tools/check-backend.mjs          (needs npm run dev)
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const problems = []
page.on('pageerror', (e) => problems.push('page error: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
page.on('response', (r) => {
  if (r.url().includes('supabase.co') && r.status() >= 400) {
    problems.push(`http ${r.status()} ${r.url().replace(/\?.*/, '')}`)
  }
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const state = await page.evaluate(() => ({
  backend: window.backend?.name ?? '(none)',
  fatal: document.querySelector('.fatal span')?.textContent ?? null,
  code: document.querySelector('.code-copy code')?.textContent ?? null,
  friends: document.querySelectorAll('.friend').length,
}))

console.log(`backend in use : ${state.backend}`)
if (state.fatal) console.log(`startup error  : ${state.fatal}`)
if (state.code) console.log(`your code      : ${state.code}`)
console.log(`friends loaded : ${state.friends}`)

if (state.backend === 'mock') {
  console.log('\n=> Still on the mock. VITE_SUPABASE_ANON_KEY is empty, or the dev server')
  console.log('   was not restarted after it was filled in (vite reads .env at startup).')
} else if (state.fatal) {
  console.log('\n=> Connected to Supabase but could not start a session.')
  if (/anonymous/i.test(state.fatal)) {
    console.log('   Enable Authentication > Sign In / Providers > Anonymous sign-ins.')
  } else if (/profile/i.test(state.fatal)) {
    console.log('   The migration has probably not been run. Paste')
    console.log('   supabase/migrations/0001_init.sql into the SQL Editor.')
  }
} else if (state.code) {
  console.log('\n=> Live on Supabase. Signed in anonymously and issued a friend code.')
}

if (problems.length) {
  console.log('\nnetwork/console problems:')
  for (const p of [...new Set(problems)].slice(0, 8)) console.log('  ' + p)
}

await browser.close()
process.exit(state.backend !== 'mock' && !state.fatal ? 0 : 1)
