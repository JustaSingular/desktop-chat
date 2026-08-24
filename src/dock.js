// The screen-edge tab: docking, dragging between edges, expand/collapse.
// Owns nothing about chat — it just hands out a .body element to fill.
import { shell } from './shell.js'
import { PANEL } from './panel-layout.js'

const STORE = 'dchat.dock.v1'

// Native pixel-art canvas size. Change these if you redraw at a different size.
const SPRITE_W = 12
const SPRITE_H = 32
const BASE_ZOOM = 3   // how big the tab looks on a 100%-scaled display

const DRAG_THRESHOLD = 5 // px before a click becomes a drag

// Pixel art only survives whole-number scaling. Windows commonly runs at 125%
// or 150%, so scaling the sprite by a flat 3x in CSS px would land it on
// fractional device pixels and smear it. Instead pick the integer device-pixel
// factor nearest the target and derive the CSS size from that, which means the
// tab is a hair bigger or smaller per monitor but always pixel-exact.
let TAB_W = SPRITE_W * BASE_ZOOM
let TAB_H = SPRITE_H * BASE_ZOOM
let PANEL_W = PANEL.w * BASE_ZOOM
let PANEL_H = PANEL.h * BASE_ZOOM
let zoom = BASE_ZOOM

function computeZoom() {
  const dpr = window.devicePixelRatio || 1
  const steps = Math.max(1, Math.round(BASE_ZOOM * dpr)) // whole device pixels
  zoom = steps / dpr
  TAB_W = SPRITE_W * zoom
  TAB_H = SPRITE_H * zoom
  // The panel is a sprite too, so it scales on exactly the same integer factor
  // as the tab — they can never drift apart.
  PANEL_W = PANEL.w * zoom
  PANEL_H = PANEL.h * zoom
}

export function createDock(root) {
  const saved = loadState()
  let edge = saved.edge
  let yRatio = saved.yRatio
  let expanded = false

  root.innerHTML = `
    <div class="panel" part="panel">
      <div class="panel-body"></div>
    </div>
    <button class="tab" type="button" aria-label="Open chat" aria-expanded="false">
      <span class="tab-sprite" aria-hidden="true">
        <span class="tab-frame rest"></span>
        <span class="tab-frame open"></span>
      </span>
      <span class="tab-badge" role="status" hidden>
        <span class="badge-frame a"></span>
        <span class="badge-frame b"></span>
      </span>
    </button>
  `

  const tab = root.querySelector('.tab')
  const badge = root.querySelector('.tab-badge')
  const body = root.querySelector('.panel-body')

  function applySizeVars() {
    computeZoom()
    // --u is one native sprite pixel; the whole UI is laid out in multiples of
    // it, so it has to be set on :root rather than on the dock alone.
    const style = document.documentElement.style
    style.setProperty('--u', zoom + 'px')
    style.setProperty('--zoom', String(zoom))
    style.setProperty('--tab-w', TAB_W + 'px')
    style.setProperty('--tab-h', TAB_H + 'px')
    style.setProperty('--panel-w', PANEL_W + 'px')
    style.setProperty('--panel-h', PANEL_H + 'px')
  }

  applySizeVars()

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE))
      if (s && (s.edge === 'left' || s.edge === 'right')) return s
    } catch {}
    return { edge: 'right', yRatio: 0.45 }
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify({ edge, yRatio })) } catch {}
  }

  // The dock box is exactly the tab. The panel hangs off it, absolutely
  // positioned, so opening and closing never moves the tab.
  function tabTop(viewportH) {
    const maxTop = Math.max(0, viewportH - TAB_H)
    let top = clamp(yRatio, 0, 1) * maxTop
    if (expanded) {
      // The panel is centred on the tab, so near the top or bottom of the
      // screen the tab has to give ground to keep the panel fully on screen.
      const half = (PANEL_H - TAB_H) / 2
      const lo = Math.min(half, maxTop)
      const hi = Math.max(lo, maxTop - half)
      top = clamp(top, lo, hi)
    }
    return top
  }

  function layout() {
    root.dataset.edge = edge
    root.dataset.state = expanded ? 'expanded' : 'collapsed'
    root.style.top = Math.round(tabTop(window.innerHeight)) + 'px'
    tab.setAttribute('aria-expanded', String(expanded))
    tab.setAttribute('aria-label', expanded ? 'Close chat' : 'Open chat')
  }

  // The monitor's work area, in screen coordinates. Cached because dragging
  // needs it on every pointer move and it only changes when the window moves
  // between monitors.
  let area = null
  let syncing = false

  async function refreshArea() {
    try { area = await shell.workArea() } catch {}
    return area
  }

  // Where the top of the tab sits on the screen, as opposed to inside the
  // window. Under Tauri the window IS the tab, so these are different things.
  function tabScreenTop(a) {
    return a.y + clamp(yRatio, 0, 1) * Math.max(0, a.height - TAB_H)
  }

  // Under Tauri the OS window is resized to hug the visible content, so the
  // rest of the screen stays clickable. In the browser this is a no-op.
  async function syncWindow() {
    if (!shell.isTauri) return
    const a = area ?? (await refreshArea())
    if (!a) return
    const width = expanded ? PANEL_W + TAB_W : TAB_W
    const height = expanded ? PANEL_H : TAB_H
    const x = edge === 'right' ? a.x + a.width - width : a.x

    // Place the window so the tab lands where the user put it, then back off
    // the panel's overhang when it is open.
    const tabY = tabScreenTop(a)
    const y = clamp(
      expanded ? tabY - (PANEL_H - TAB_H) / 2 : tabY,
      a.y,
      a.y + Math.max(0, a.height - height)
    )
    await shell.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
  }

  const api = {
    body,
    get expanded() { return expanded },

    async toggle(force) {
      const next = force ?? !expanded
      if (next === expanded) return
      expanded = next
      if (expanded) await syncWindow()   // grow the window before sliding out
      layout()
      root.dispatchEvent(new CustomEvent('dock:toggle', { detail: { expanded } }))
      if (!expanded) {
        // shrink only after the slide-in finishes, or it clips mid-animation
        setTimeout(syncWindow, 220)
      }
    },

    // The drawn bubble is 6 native px — far too small for a number, so it
    // signals "something is waiting" and the per-friend counts stay in the
    // friend list. The count still reaches screen readers.
    setBadge(n) {
      badge.hidden = n <= 0
      badge.setAttribute('aria-label', n === 1 ? '1 unread message' : `${n} unread messages`)
    },
  }

  // --- drag / click on the tab ---
  let drag = null

  tab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    tab.setPointerCapture(e.pointerId)
    root.classList.add('grabbing')

    // Under Tauri the window is only as big as the tab and moves with the
    // pointer, so clientX/Y are measured against a 38x102 box that is sliding
    // around underneath the cursor — the numbers are meaningless. screenX/Y are
    // absolute and stay correct no matter where the window goes.
    if (shell.isTauri) {
      refreshArea()
      drag = { screen: true, moved: false, startX: e.screenX, startY: e.screenY, grabDY: null }
    } else {
      drag = {
        screen: false, moved: false,
        startX: e.clientX, startY: e.clientY,
        grabOffset: e.clientY - root.getBoundingClientRect().top,
      }
    }
  })

  tab.addEventListener('pointermove', (e) => {
    if (!drag) return
    const px = drag.screen ? e.screenX : e.clientX
    const py = drag.screen ? e.screenY : e.clientY
    if (!drag.moved && Math.hypot(px - drag.startX, py - drag.startY) < DRAG_THRESHOLD) return
    drag.moved = true

    if (drag.screen) {
      if (!area) return                       // work area not known yet
      // Measured on first real movement so the tab keeps the same grip point.
      if (drag.grabDY === null) drag.grabDY = drag.startY - tabScreenTop(area)

      const maxTop = Math.max(1, area.height - TAB_H)
      yRatio = clamp((py - drag.grabDY - area.y) / maxTop, 0, 1)
      edge = px < area.x + area.width / 2 ? 'left' : 'right'

      layout()
      liveMove()
      return
    }

    // Browser: the page is the screen, so viewport coordinates are correct.
    const maxTop = Math.max(1, window.innerHeight - TAB_H)
    yRatio = clamp((py - drag.grabOffset) / maxTop, 0, 1)
    edge = px < window.innerWidth / 2 ? 'left' : 'right'
    layout()
  })

  // Move the OS window as the drag happens, without queueing a request per
  // pointer event.
  function liveMove() {
    if (syncing) return
    syncing = true
    syncWindow().finally(() => { syncing = false })
  }

  const endDrag = (e) => {
    if (!drag) return
    const wasDrag = drag.moved
    drag = null
    root.classList.remove('grabbing')
    try { tab.releasePointerCapture(e.pointerId) } catch {}
    if (wasDrag) { persist(); syncWindow() }
    else api.toggle()
  }
  tab.addEventListener('pointerup', endDrag)
  tab.addEventListener('pointercancel', endDrag)

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expanded) api.toggle(false)
  })
  // Moving between monitors can change devicePixelRatio, which changes the
  // integer scale the sprite needs.
  window.addEventListener('resize', () => {
    applySizeVars()
    refreshArea().then(syncWindow)
    layout()
  })

  layout()
  refreshArea().then(syncWindow)
  return api
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }
