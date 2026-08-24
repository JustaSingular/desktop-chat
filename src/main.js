import { createDock } from './dock.js'
import { createChat } from './chat.js'
import { shell } from './shell.js'
import { backend } from './backend/index.js'
import { applyTheme, savedTheme } from './palette.js'

// Restore the chosen style before anything is drawn. The default style needs
// no work, so this does not delay first paint.
applyTheme(savedTheme())

const dock = createDock(document.getElementById('dock'))
shell.setAlwaysOnTop(true)

// Browser-only: a fake desktop behind the tab so the edge docking reads right.
if (!shell.isTauri) document.body.classList.add('browser-preview')

try {
  await backend.init()
  createChat(dock.body, dock)
} catch (err) {
  // A dead backend should say so, not leave an empty panel.
  dock.body.innerHTML = `<div class="fatal"><strong>can't connect</strong><span></span></div>`
  dock.body.querySelector('.fatal span').textContent = err.message
  console.error(err)
}
