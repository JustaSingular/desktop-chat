// Window-level operations. In the browser these are no-ops against a fake
// desktop; under Tauri they drive the real always-on-top window.
// Swapping to Tauri = filling in the `tauri` branch, nothing else changes.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const shell = {
  isTauri,

  // Screen area the tab is allowed to dock against.
  async workArea() {
    if (!isTauri) {
      return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    }
    const { currentMonitor } = await import('@tauri-apps/api/window')
    const m = await currentMonitor()
    const s = m.scaleFactor
    return {
      x: m.position.x / s,
      y: m.position.y / s,
      width: m.size.width / s,
      height: m.size.height / s,
    }
  },

  // Collapsed => window is just the tab. Expanded => tab + panel.
  // Keeping the window tight means clicks pass through to whatever is behind it.
  async setBounds({ x, y, width, height }) {
    if (!isTauri) return
    const { getCurrentWindow, LogicalPosition, LogicalSize } = await import('@tauri-apps/api/window')
    const w = getCurrentWindow()
    await w.setSize(new LogicalSize(width, height))
    await w.setPosition(new LogicalPosition(x, y))
  },

  async setAlwaysOnTop(on) {
    if (!isTauri) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setAlwaysOnTop(on)
  },
}
