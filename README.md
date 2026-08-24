# desktop chat

A screen-edge pull-out chat tab. Click the arrow, a panel slides out, you message
a friend you added by friend code.

## Run it

    npm install
    npm run dev      # http://localhost:5173

With no Supabase key configured it runs on a **local mock backend**
(localStorage), so the whole UI works with no server. It starts empty — no fake
friends — because inventing them made it easy to mistake for a working
connection. Add `?backend=mock` to force it even when a key is set. In the
browser console:

    await backend.addFriend('AAAA-1111')       // any well-formed code works
    backend._receive('<friend id>', 'hello')   // fakes an inbound message
    backend.reset()                            // wipe local state

## Connecting the real backend

1. **Run the migration.** Open the Supabase dashboard for your project, go to
   the SQL Editor, paste all of `supabase/migrations/0001_init.sql`, run it.
   It is idempotent — re-running is safe.

2. **Turn on anonymous sign-ins.** Authentication → Sign In / Providers →
   enable *Anonymous sign-ins*. This is what gives each install an identity
   without a login screen. Nothing works until this is on.

3. **Add the key.** Project Settings → API Keys → copy the `anon` /
   publishable key into `.env`:

       VITE_SUPABASE_ANON_KEY=eyJ...

   Restart `npm run dev`. The app switches off the mock automatically.

The anon key is meant to be public and is safe to ship inside the app you send
to friends — every table is behind RLS. The `service_role` key is not; it must
never enter this project.

## Verifying the schema

`supabase/test/` holds a throwaway-Postgres harness. With Docker running:

    bash supabase/test/run.sh

It applies the migration twice (idempotency) and asserts the security model:
strangers can't read profiles, friendships, or messages; you can't message a
non-friend or forge a sender; message bodies are immutable once sent; friend
codes can't be changed; unread counts follow `read_at`; and `anon` is locked out
of every table except `keepalive`, which it may read and only read. All eleven
currently pass.

## Checking the backend

    node tools/check-backend.mjs      # which backend is live, and why
    node tools/check-roundtrip.mjs    # two accounts, add by code, realtime delivery

The first distinguishes the three things that go wrong when wiring Supabase up:
key missing, migration not run, anonymous sign-ins off. The second drives two
isolated browsers through a real conversation and writes real rows — it prints
the cleanup SQL when it finishes.

## Verifying the UI

With `npm run dev` running in another terminal:

    npm run verify

Drives a real browser and asserts the dock geometry: the tab is flush to the
screen edge and stays there when the panel opens, the panel parks off screen
when closed and is fully on screen when open, the sprite renders `pixelated`,
the correct frame shows per state, dragging snaps to the opposite edge, and
nothing throws, and scrolling works with the scrollbars hidden. Screenshots
land in `tools/screenshots/` (gitignored).

Worth keeping: the tab once vanished one frame after load because a CSS rule
used `var(--panel-w)` before JS had defined it, so the rule was dropped on the
first paint and applied after. Every geometry variable now has a fallback in
`:root`, and this check would catch a regression.

## What works

- Tab docks to the left or right screen edge; drag it vertically or across the
  screen midpoint to switch edges. Position persists.
- Click the arrow to slide the panel out; Esc closes it.
- Friend list dropdown, add-by-code (`ABCD-1234`, auto-formats as you type),
  your own code with a copy button.
- 1-on-1 text chat with history and per-friend unread counts.
- Unread bubble on the tab, cleared when you open that chat.
- Realtime delivery via one Supabase channel filtered to messages addressed to you.

## Structure

    src/dock.js           edge docking, drag, expand/collapse. no chat knowledge.
    src/chat.js           panel contents: friend list, log, composer, style menu.
    src/panel-layout.js   where each sprite sits, in native pixels.
    src/palette.js        style switcher: recolours the sprites at runtime.
    src/shell.js          window ops. no-ops in browser, drives the real window in Tauri.
    src/config.js         build-time Supabase URL + key.
    src/backend/mock.js   fake backend, no server needed.
    src/backend/supabase.js  real backend. identical surface to the mock.
    src/backend/index.js  the one line that picks which backend is live.

## The art pipeline

The whole UI is pixel art, scaled by whole numbers only. Nothing is hand-placed:
`art/sprites.json` names every sprite and the rect it is cut from, and
`src/panel-layout.js` says where each one sits inside the panel in native pixels.

After changing a sheet:

    powershell -File tools/export-sprites.ps1

That re-cuts all 17 sprites into `src/sprites/`. They live under `src/` so Vite
resolves and hashes them, which keeps the urls right in dev, in the build, and
behind Tauri's asset protocol.

| piece | native | notes |
|---|---|---|
| panel | 85 x 127 | bare frame + log well |
| tab | 12 x 32 | two frames: light/arrow-in, dark/arrow-out |
| unread bubble | 6 x 6 | two reds that alternate on a 640ms hard cut |
| friend bar | 45 x 10 at 11,9 | its own dropdown trigger, chevron drawn in |
| style button | 9 x 10 at 65,9 | opens the style menu |
| log | 69 x 76 at 8,24 | |
| message input | 57 x 8 at 9,109 | |
| send | 9 x 11 at 68,106 | |

Panel furniture rects are cut from the **composed** panel frames rather than the
loose components, so a piece can never end up a pixel off from the panel it
sits in. The eight panel frames on the sheet are the 2^3 combinations of the
three pressed states; only frames 0, 1, 2 and 4 are needed to derive them all.

Rules for the art: draw at 1x native, transparent background, no anti-aliasing,
and stay on the six-colour ramp (`000000 091305 12270b 244d15 3e8725 50ae30`) —
the style switcher keys off those exact values. Colours outside the ramp pass
through untouched, which is how the unread bubble's two reds stay red in every
style.

The unread bubble carries no number: at 6 native px there is nowhere to put one.
It means "something is waiting"; the per-friend counts stay in the friend list,
and the real count still goes to screen readers. It holds still for anyone with
reduced-motion turned on.

Other sheet tools, all of which take any sheet:

    tools/inspect-sheet.ps1      bounding box of every component
    tools/slice-components.ps1   flood-fill each shape apart, optionally export
    tools/map-frame.ps1          print a region as an ascii colour map
    tools/diff-frames.ps1        what differs between same-size frames
    tools/contact-sheet.ps1      labelled grid of crops, scaled up
    tools/panel-freespace.ps1    which pixels of the panel body the UI covers

## Styles

The style button swaps the whole app's palette. Because the art uses a fixed
six-colour ramp, a style is just another ramp: `src/palette.js` redraws every
sprite on a canvas with the colours remapped and points the CSS variables at the
results. One set of art, any number of styles, no redrawing.

Five ship (moss, slate, amber, berry, ice). Adding one is a six-colour entry in
`THEMES`. The choice persists, and the default costs nothing — the stylesheet
already points at the original files, so there is no flash on load.

## Text

Silkscreen (SIL OFL, `art/OFL.txt`), inlined as base64 into `src/fonts.css` by
`node tools/embed-font.mjs`. Inlined rather than linked because a url() in CSS
resolves three different ways across dev, the bundle, and Tauri; at 16 KB the
base64 is cheaper than the bug.

Silkscreen is drawn on an 8px grid, so only whole multiples stay crisp. Two
knobs in `:root`: `--text-scale` (bar, menus, input) and `--log-scale`
(messages). The log runs one step smaller because the panel is only 69 native px
across and fitting words matters more there than matching the art's pixel size.

## Known limits

- **Identity lives in localStorage.** Clearing site data (or the Tauri webview's
  storage) loses the anonymous account and its friend code. Fine for v1; an
  export/import of the account key would fix it.
- **Instant add.** Anyone who knows your code can message you with no approval
  step. The code space is ~6.5e11 so it isn't guessable in practice, but there
  is no block/remove-friend UI yet (the DB policy already allows unfriending).
- **Display names** default to `friend ABCD`. The column and its policy exist;
  there's no UI to change yours yet.

## The desktop app

    npm run app:dev        # runs it as a real window, hot-reloads like the browser
    npm run app:build      # produces the installer

The window is transparent, undecorated, always on top and kept out of the
taskbar. `src/shell.js` resizes it to hug the visible art — just the tab when
collapsed — so the rest of the screen stays clickable rather than being covered
by an invisible full-screen window.

There is no close button, so quitting is via the tray icon. A second launch
focuses the running one instead of starting an invisible duplicate.

The built installer lands in:

    src-tauri/target/release/bundle/nsis/

Two things in `src-tauri/tauri.conf.json` worth knowing, since JSON cannot carry
comments and the schema rejects stray keys:

- `app.security.csp` **names the Supabase project explicitly** in `connect-src`.
  If the project ref ever changes, change it there too or the built app will
  silently fail to reach the backend while working fine in the browser.
- The window opens at 36x96 — the collapsed tab at 3x — and `dock.js` resizes it
  as soon as it knows the real dpi. That initial size is only what shows for the
  first frame.

## Sending it to friends

    git tag v0.1.0 && git push origin v0.1.0

That triggers `.github/workflows/release.yml`, which builds the installer on a
clean Windows runner and attaches it to a GitHub Release. Send them that link.
Building on CI rather than locally means the release does not depend on your
machine, and the workflow fails loudly if the backend config is missing rather
than shipping an installer that silently falls back to the offline mock.

What your friends see: Windows warns that the publisher is unrecognised, because
the app is not code signed. **More info -> Run anyway**. Getting rid of that
needs a code-signing certificate, which is a few hundred a year and almost
certainly not worth it here.

They need nothing else installed — WebView2 ships with Windows 11. On first
launch the app creates its own anonymous account and shows them their friend
code.

## Next step

Identity still lives in the webview's localStorage, so clearing site data loses
the account and its friend code with no way to recover it. That is the main
rough edge before this goes to people who will actually keep using it — an
export/import of the account key would fix it.
