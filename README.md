# desktop chat

A screen-edge pull-out chat tab. Click the arrow, a panel slides out, you message
a friend you added by friend code.

## Run it

    npm install
    npm run dev      # http://localhost:5173

With no Supabase key configured it runs on a **local mock backend** (localStorage),
so the whole UI works with no server. Seeded with two fake friends; "Echo Bot"
replies to anything you send. In the browser console:

    backend._receive('sam', 'hello')     // red badge appears on the tab
    backend.reset()                      // wipe local state

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
codes can't be changed; unread counts follow `read_at`; the `anon` role is
locked out entirely. All ten currently pass.

## Verifying the UI

With `npm run dev` running in another terminal:

    npm run verify

Drives a real browser and asserts the dock geometry: the tab is flush to the
screen edge and stays there when the panel opens, the panel parks off screen
when closed and is fully on screen when open, the sprite renders `pixelated`,
the correct frame shows per state, dragging snaps to the opposite edge, and
nothing throws. Screenshots land in `tools/screenshots/`.

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

## Next step

Wrap in Tauri v2 as a transparent, always-on-top, no-taskbar window. `src/shell.js`
already contains the window-resizing logic so the rest of the screen stays
clickable when the tab is collapsed. Needs the Rust toolchain:

    winget install Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
