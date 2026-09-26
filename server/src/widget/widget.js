/*! MECGURA website chat — <script src="https://api.mecgura.tech/widget.js" data-key="wk_…" async></script> */
(function () {
  'use strict'
  var me = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]')
  if (!me || window.__mecguraChat) return
  window.__mecguraChat = true
  var KEY = me.getAttribute('data-key')
  var API = new URL(me.src).origin
  var BASE = API + '/widget/' + encodeURIComponent(KEY)
  var STORE = 'mecgura_chat_' + KEY
  var state = load()
  var cfg = null, open = false, lastId = 0, timer = null, unread = 0, sending = false, seen = {}

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') } catch (e) { return {} } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)) } catch (e) { /* private mode */ } }
  function req(method, path, body) {
    return fetch(BASE + path, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Error'); e.status = r.status; throw e } return j }) })
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  var ICON_X = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  var ICON_SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>'
  var ICON_WA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/></svg>'

  function css(c) {
    return ':host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
      '.wrap{position:fixed;bottom:20px;' + (c.position === 'left' ? 'left' : 'right') + ':20px;z-index:2147483000;display:flex;flex-direction:column;align-items:' + (c.position === 'left' ? 'flex-start' : 'flex-end') + ';gap:12px}' +
      '.launch{display:flex;align-items:center;gap:10px;border:0;cursor:pointer;background:' + c.color + ';color:#fff;border-radius:999px;height:58px;min-width:58px;padding:0 16px;justify-content:center;box-shadow:0 10px 30px -8px rgba(0,0,0,.45);transition:transform .15s}' +
      '.launch:hover{transform:translateY(-2px)}.launch span{font-size:14px;font-weight:600}' +
      '.badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;border-radius:999px;min-width:20px;height:20px;display:grid;place-items:center;padding:0 5px}' +
      '.lw{position:relative}' +
      '.panel{width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px -12px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.06)}' +
      '.hd{background:' + c.color + ';color:#fff;padding:16px 16px 18px;display:flex;align-items:flex-start;gap:12px}' +
      '.hd .t{font-weight:700;font-size:16px;line-height:1.2}.hd .s{font-size:12.5px;opacity:.9;margin-top:3px;display:flex;align-items:center;gap:6px}' +
      '.dot{width:8px;height:8px;border-radius:50%;background:#a7f3d0;display:inline-block}.dot.off{background:#fde68a}' +
      '.x{margin-left:auto;background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:10px;width:34px;height:34px;display:grid;place-items:center;cursor:pointer}' +
      '.body{flex:1;overflow-y:auto;padding:16px 14px;background:#f5f7f6;display:flex;flex-direction:column;gap:8px}' +
      '.m{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;color:#111827}' +
      '.m.in{align-self:flex-end;background:' + c.color + ';color:#fff;border-bottom-right-radius:4px}' +
      '.m.out{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}' +
      '.who{font-size:11px;color:#6b7280;margin:2px 4px -4px;align-self:flex-start}' +
      '.m img{max-width:100%;border-radius:10px;display:block;margin-bottom:4px}.m a{color:inherit;text-decoration:underline}' +
      '.btns{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:90%}' +
      '.btns button{border:1px solid ' + c.color + ';background:#fff;color:' + c.color + ';border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;font-weight:600}' +
      '.btns button:hover{background:' + c.color + ';color:#fff}' +
      '.ft{border-top:1px solid #eef0f2;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}' +
      '.ft textarea{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;font-size:14px;max-height:110px;min-height:42px;outline:none;color:#111827;background:#fff}' +
      '.ft textarea:focus{border-color:' + c.color + '}' +
      '.send{border:0;background:' + c.color + ';color:#fff;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;cursor:pointer}.send:disabled{opacity:.5}' +
      '.wa{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 10px 10px;padding:9px;border-radius:12px;background:#25D366;color:#fff;font-size:13px;font-weight:700;text-decoration:none}' +
      '.pw{text-align:center;font-size:10.5px;color:#9ca3af;padding:0 0 8px;background:#fff}.pw a{color:#6b7280;text-decoration:none}' +
      '.form{padding:14px;display:flex;flex-direction:column;gap:9px;background:#fff;border-top:1px solid #eef0f2}' +
      '.form input{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:14px;outline:none;color:#111827;background:#fff}.form input:focus{border-color:' + c.color + '}' +
      '.form button{border:0;background:' + c.color + ';color:#fff;border-radius:10px;padding:11px;font-weight:700;font-size:14px;cursor:pointer}' +
      '.form p{margin:0;font-size:12.5px;color:#6b7280}.err{color:#b91c1c;font-size:12px;padding:0 14px 8px;background:#fff}' +
      '@media (max-width:480px){.wrap{bottom:12px;' + (c.position === 'left' ? 'left' : 'right') + ':12px}.panel{width:calc(100vw - 24px);height:calc(100vh - 96px)}}'
  }

  function mount() {
    var host = el('div'); host.id = 'mecgura-chat'
    document.body.appendChild(host)
    var root = host.attachShadow({ mode: 'open' })
    var style = el('style'); style.textContent = css(cfg); root.appendChild(style)
    var wrap = el('div', 'wrap'); root.appendChild(wrap)

    var panel = el('div', 'panel'); panel.style.display = 'none'
    var hd = el('div', 'hd')
    var ht = el('div'); ht.appendChild(el('div', 't', cfg.title || cfg.business))
    var sub = el('div', 's'); var dot = el('span', 'dot' + (cfg.online ? '' : ' off')); sub.appendChild(dot); sub.appendChild(el('span', '', cfg.online ? cfg.subtitle : 'We will reply as soon as we are back'))
    ht.appendChild(sub); hd.appendChild(ht)
    var x = el('button', 'x'); x.innerHTML = ICON_X; x.setAttribute('aria-label', 'Close chat'); hd.appendChild(x)
    var body = el('div', 'body')
    var err = el('div', 'err'); err.style.display = 'none'
    var form = el('div', 'form')
    var ft = el('div', 'ft')
    var ta = el('textarea'); ta.rows = 1; ta.placeholder = 'Type your message…'
    var send = el('button', 'send'); send.innerHTML = ICON_SEND; send.setAttribute('aria-label', 'Send')
    ft.appendChild(ta); ft.appendChild(send)
    panel.appendChild(hd); panel.appendChild(body); panel.appendChild(err); panel.appendChild(form); panel.appendChild(ft)
    if (cfg.whatsapp) { var wa = el('a', 'wa'); wa.href = cfg.whatsapp; wa.target = '_blank'; wa.rel = 'noopener'; wa.innerHTML = ICON_WA; wa.appendChild(document.createTextNode(' Continue on WhatsApp')); panel.appendChild(wa) }
    var pw = el('div', 'pw'); var pwa = el('a', '', 'Powered by MECGURA'); pwa.href = 'https://www.mecgura.tech'; pwa.target = '_blank'; pwa.rel = 'noopener'; pw.appendChild(pwa); panel.appendChild(pw)

    var lw = el('div', 'lw')
    var launch = el('button', 'launch'); launch.setAttribute('aria-label', 'Open chat')
    var badge = el('div', 'badge'); badge.style.display = 'none'
    lw.appendChild(launch); lw.appendChild(badge)
    wrap.appendChild(panel); wrap.appendChild(lw)

    function setLauncher() {
      launch.innerHTML = open ? ICON_X : ICON_CHAT
      if (!open && cfg.launcher_text) launch.appendChild(el('span', '', cfg.launcher_text))
      badge.style.display = !open && unread ? 'grid' : 'none'; badge.textContent = String(unread)
    }
    function showErr(m) { err.textContent = m || ''; err.style.display = m ? 'block' : 'none' }
    function needDetails() { return cfg.ask_details && !state.vid && !state.skip }
    function renderForm() {
      form.innerHTML = ''
      form.style.display = needDetails() ? 'flex' : 'none'
      ft.style.display = needDetails() ? 'none' : 'flex'
      if (!needDetails()) return
      form.appendChild(el('p', '', 'Share your details so we can get back to you:'))
      var n = el('input'); n.placeholder = 'Your name'; n.autocomplete = 'name'
      var p = el('input'); p.placeholder = 'WhatsApp / phone number'; p.autocomplete = 'tel'; p.inputMode = 'tel'
      var e = el('input'); e.placeholder = 'Email (optional)'; e.autocomplete = 'email'; e.type = 'email'
      var b = el('button', '', 'Start chat')
      b.onclick = function () {
        if (!n.value.trim()) { n.focus(); return }
        state.name = n.value.trim(); state.phone = p.value.trim(); state.email = e.value.trim(); state.skip = true; save(); renderForm(); ta.focus()
      }
      form.appendChild(n); form.appendChild(p); form.appendChild(e); form.appendChild(b)
    }
    function bubble(m) {
      if (seen[m.id]) return
      seen[m.id] = 1
      if (m.from === 'agent' && m.agent) body.appendChild(el('div', 'who', m.agent))
      var d = el('div', 'm ' + (m.from === 'visitor' ? 'in' : 'out'))
      if (m.media && m.media.url) {
        if (m.media.type === 'image') { var img = el('img'); img.src = m.media.url; img.alt = ''; d.appendChild(img) }
        else { var a = el('a', '', m.media.type === 'document' ? 'Open document' : 'Open ' + m.media.type); a.href = m.media.url; a.target = '_blank'; a.rel = 'noopener'; d.appendChild(a) }
        if (m.text && !/^\[/.test(m.text)) d.appendChild(el('div', '', m.text))
      } else d.appendChild(document.createTextNode(m.text || ''))
      if (m.link && m.link.url) { d.appendChild(document.createElement('br')); var l = el('a', '', m.link.text || m.link.url); l.href = m.link.url; l.target = '_blank'; l.rel = 'noopener'; d.appendChild(l) }
      body.appendChild(d)
      var old = body.querySelectorAll('.btns'); for (var i = 0; i < old.length; i++) old[i].remove()
      if (m.buttons && m.buttons.length) {
        var bs = el('div', 'btns')
        m.buttons.forEach(function (b) { var bt = el('button', '', b.title); bt.onclick = function () { post(b.title, b.id) }; bs.appendChild(bt) })
        body.appendChild(bs)
      }
    }
    function render(list) {
      var fresh = 0
      list.forEach(function (m) { if (!seen[m.id]) { if (m.from !== 'visitor') fresh++; bubble(m) } lastId = Math.max(lastId, m.id) })
      if (fresh && !open) { unread += fresh; setLauncher() }
      if (list.length) body.scrollTop = body.scrollHeight
    }
    function greet() { if (!body.childNodes.length && cfg.greeting) { var g = el('div', 'm out', cfg.greeting); body.appendChild(g) } }
    function session() {
      if (state.vid) return Promise.resolve()
      return req('POST', '/session', {}).then(function (s) { state.vid = s.visitor_id; state.token = s.token; save() })
    }
    function poll() {
      if (!state.vid) return
      req('GET', '/messages?vid=' + encodeURIComponent(state.vid) + '&token=' + encodeURIComponent(state.token) + '&after=' + lastId)
        .then(function (r) { dot.className = 'dot' + (r.online ? '' : ' off'); render(r.messages) })
        .catch(function (e) { if (e.status === 401 || e.status === 404) { state = {}; save() } })
    }
    function schedule() { clearInterval(timer); timer = setInterval(poll, open ? 3000 : 15000) }
    function post(text, buttonId) {
      text = (text || '').trim()
      if ((!text && !buttonId) || sending) return
      sending = true; send.disabled = true; showErr('')
      var first = !state.sent
      session().then(function () {
        return req('POST', '/messages', { vid: state.vid, token: state.token, text: text, button_id: buttonId, after: lastId,
          name: first ? state.name : undefined, phone: first ? state.phone : undefined, email: first ? state.email || undefined : undefined, page: location.href.slice(0, 500) })
      }).then(function (r) { state.sent = true; save(); ta.value = ''; render(r.messages) })
        .catch(function (e) { showErr(e.message || 'Could not send. Please try again.') })
        .then(function () { sending = false; send.disabled = false; ta.focus() })
    }
    function toggle() {
      open = !open
      panel.style.display = open ? 'flex' : 'none'
      if (open) { unread = 0; greet(); renderForm(); poll(); setTimeout(function () { body.scrollTop = body.scrollHeight; if (!needDetails()) ta.focus() }, 50) }
      setLauncher(); schedule()
    }
    launch.onclick = toggle; x.onclick = toggle
    send.onclick = function () { post(ta.value) }
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(ta.value) } })
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(110, ta.scrollHeight) + 'px' })
    setLauncher(); schedule(); poll()
    window.MecguraChat = { open: function () { if (!open) toggle() }, close: function () { if (open) toggle() } }
  }

  req('GET', '/config').then(function (c) {
    cfg = c
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
  }).catch(function () { /* chat disabled or wrong key: stay invisible */ })
})()
