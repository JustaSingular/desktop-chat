// Where every piece sits inside the panel sprite, in native pixels.
// Mirrors the `_layout` block in art/sprites.json — keep the two in step.
//
// Everything on screen is these numbers multiplied by the current integer
// zoom, which is why the UI can never drift out of alignment with the art.

export const PANEL = { w: 85, h: 127 }

export const RECT = {
  // the friend-list dropdown trigger; its chevron is drawn into the sprite
  bar:      { x: 11, y: 9, w: 45, h: 10 },
  // opens the style switcher — a separate menu, not part of the friend list
  style:    { x: 65, y: 9, w: 9, h: 10 },
  logInner: { x: 8, y: 24, w: 69, h: 76 },
  input:    { x: 9, y: 109, w: 57, h: 8 },
  send:     { x: 68, y: 106, w: 9, h: 11 },

  // dropdowns hang below their triggers; both use the 45x49 dropdown sprite
  friendsDrop: { x: 11, y: 19, w: 45, h: 49 },
  stylesDrop:  { x: 29, y: 19, w: 45, h: 49 },
}

// Every sprite the UI paints, by name. palette.js loads and recolours these.
export const SPRITES = [
  'panel',
  'bar-rest', 'bar-active',
  'style-rest', 'style-active',
  'send-rest', 'send-active',
  'input',
  'dropdown', 'dropdown-rest', 'dropdown-active',
  'bubble', 'bubble-sm',
  'btn-rest', 'btn-active',
  'tab-rest', 'tab-open',
  'badge-a', 'badge-b',
]
