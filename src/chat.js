// Panel contents. Every element is positioned from panel-layout.js in native
// sprite pixels, so the UI sits exactly where the art expects it.
import { backend } from './backend/index.js'
import { THEMES, applyTheme, currentTheme } from './palette.js'

export function createChat(mount, dock) {
  let me = null
  let friends = []
  let activeId = null
  let openMenu = null   // 'friends' | 'styles' | null

  mount.innerHTML = `
    <div class="chat">
      <button class="friendbar" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="friend-name">friend list</span>
      </button>

      <button class="stylebtn" type="button" aria-haspopup="menu" aria-expanded="false"
              title="Change style" aria-label="Change style"></button>

      <div class="drop friends-drop" hidden>
        <ul class="friend-list"></ul>
        <form class="add-friend">
          <input class="code-input" maxlength="9" placeholder="ABCD-1234"
                 aria-label="Friend code" spellcheck="false" />
          <button class="add-btn" type="submit" aria-label="Add friend"></button>
        </form>
        <div class="add-error" hidden></div>
        <button class="code-copy" type="button" title="copy your code"><code></code></button>
      </div>

      <div class="drop styles-drop" hidden>
        <ul class="style-list"></ul>
      </div>

      <div class="log" role="log" aria-live="polite"></div>

      <form class="composer">
        <input class="msg-input" aria-label="Message" autocomplete="off" />
        <button class="send" type="submit" aria-label="Send"></button>
      </form>
    </div>
  `

  const el = {
    bar: mount.querySelector('.friendbar'),
    name: mount.querySelector('.friend-name'),
    styleBtn: mount.querySelector('.stylebtn'),
    friendsDrop: mount.querySelector('.friends-drop'),
    stylesDrop: mount.querySelector('.styles-drop'),
    list: mount.querySelector('.friend-list'),
    styleList: mount.querySelector('.style-list'),
    addForm: mount.querySelector('.add-friend'),
    code: mount.querySelector('.code-input'),
    addErr: mount.querySelector('.add-error'),
    myCode: mount.querySelector('.code-copy code'),
    copyBtn: mount.querySelector('.code-copy'),
    log: mount.querySelector('.log'),
    composer: mount.querySelector('.composer'),
    input: mount.querySelector('.msg-input'),
  }

  const totalUnread = () => friends.reduce((n, f) => n + (f.unread ?? 0), 0)

  function setMenu(which) {
    openMenu = which
    el.friendsDrop.hidden = which !== 'friends'
    el.stylesDrop.hidden = which !== 'styles'
    el.bar.setAttribute('aria-expanded', String(which === 'friends'))
    el.styleBtn.setAttribute('aria-expanded', String(which === 'styles'))
    if (which === 'friends') el.code.focus()
  }

  function renderFriends() {
    el.list.innerHTML = friends
      .map(
        (f) => `
        <li>
          <button type="button" class="friend ${f.id === activeId ? 'active' : ''}" data-id="${f.id}">
            <span class="fname">${escapeHtml(f.name)}</span>
            ${f.unread ? `<span class="pill">${f.unread}</span>` : ''}
          </button>
        </li>`
      )
      .join('')
    const active = friends.find((f) => f.id === activeId)
    el.name.textContent = active ? active.name : 'friend list'
    dock.setBadge(totalUnread())
  }

  function renderStyles() {
    const now = currentTheme().id
    el.styleList.innerHTML = THEMES.map(
      (t) => `
      <li>
        <button type="button" class="style-opt ${t.id === now ? 'active' : ''}" data-id="${t.id}">
          <span class="swatch" style="background:#${t.ramp[5]};border-color:#${t.ramp[0]}"></span>
          <span class="sname">${escapeHtml(t.label)}</span>
        </button>
      </li>`
    ).join('')
  }

  async function renderLog() {
    if (!activeId) {
      el.log.innerHTML = `<div class="empty">pick a friend</div>`
      return
    }
    const msgs = await backend.messages(activeId)
    el.log.innerHTML = msgs.length
      ? msgs
          .map(
            (m) => `
        <div class="msg ${m.from === 'me' ? 'mine' : 'theirs'}">
          <span class="bubble">${escapeHtml(m.body)}</span>
        </div>`
          )
          .join('')
      : `<div class="empty">no messages yet</div>`
    el.log.scrollTop = el.log.scrollHeight
  }

  async function selectFriend(id) {
    activeId = id
    await backend.markRead(id)
    friends = await backend.friends()
    renderFriends()
    await renderLog()
    setMenu(null)
    el.input.focus()
  }

  el.bar.addEventListener('click', () => setMenu(openMenu === 'friends' ? null : 'friends'))

  el.styleBtn.addEventListener('click', () => {
    renderStyles()
    setMenu(openMenu === 'styles' ? null : 'styles')
  })

  el.styleList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.style-opt')
    if (!btn) return
    await applyTheme(btn.dataset.id)
    renderStyles()
  })

  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('.friend')
    if (btn) selectFriend(btn.dataset.id)
  })

  el.addForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    el.addErr.hidden = true
    try {
      const friend = await backend.addFriend(el.code.value)
      el.code.value = ''
      friends = await backend.friends()
      renderFriends()
      selectFriend(friend.id)
    } catch (err) {
      el.addErr.textContent = err.message
      el.addErr.hidden = false
    }
  })

  // Auto-insert the dash so what is typed always matches the code format.
  el.code.addEventListener('input', () => {
    let v = el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4)
    el.code.value = v
  })

  el.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(me.code)
      el.copyBtn.classList.add('copied')
      setTimeout(() => el.copyBtn.classList.remove('copied'), 900)
    } catch {}
  })

  el.composer.addEventListener('submit', async (e) => {
    e.preventDefault()
    const body = el.input.value.trim()
    if (!body || !activeId) return
    el.input.value = ''
    await backend.send(activeId, body)
    await renderLog()
  })

  // Clicking anywhere else in the panel closes an open menu.
  mount.addEventListener('pointerdown', (e) => {
    if (!openMenu) return
    if (e.target.closest('.drop, .friendbar, .stylebtn')) return
    setMenu(null)
  })

  backend.subscribe(async (evt) => {
    if (evt.type === 'friends') {
      friends = await backend.friends()
      renderFriends()
      return
    }
    if (evt.type === 'message') {
      // Inbound message for a chat that is not on screen => unread + tab badge.
      const inbound = evt.message.from !== 'me'
      const visible = dock.expanded && evt.friendId === activeId
      if (inbound && !visible) await backend.bumpUnread(evt.friendId)
      if (evt.friendId === activeId) await renderLog()
      friends = await backend.friends()
      renderFriends()
    }
  })

  // Opening the panel clears unread for whoever is on screen.
  mount.closest('.dock')?.addEventListener('dock:toggle', async (e) => {
    if (e.detail.expanded && activeId) {
      await backend.markRead(activeId)
      friends = await backend.friends()
      renderFriends()
      await renderLog()
      el.input.focus()
    } else if (!e.detail.expanded) {
      setMenu(null)
    }
  })

  ;(async () => {
    me = await backend.me()
    friends = await backend.friends()
    el.myCode.textContent = me.code
    activeId = friends[0]?.id ?? null
    renderFriends()
    renderStyles()
    await renderLog()
  })()
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
