/*! MECGURA web chat widget. Embed: <script src="https://YOUR-DOMAIN/widget.js" data-key="CHAT_KEY" async></script> */
(function () {
  var script = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]');
  if (!script) return;
  var key = script.getAttribute("data-key");
  if (!key || !/^[a-f0-9]{48}$/.test(key)) return;
  var api = new URL(script.src).origin + "/api/webchat/" + key;
  var store = null;
  try { store = window.localStorage; } catch (e) { /* private mode: keep the id in memory */ }
  var visitorId = null;
  try { visitorId = store && store.getItem("mgc_visitor_" + key); } catch (e) { /* ignore */ }
  if (!visitorId) {
    var bytes = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    visitorId = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    try { store && store.setItem("mgc_visitor_" + key, visitorId); } catch (e) { /* ignore */ }
  }

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
  var root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  fetch(api).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !data.config) return;
    build(data.config);
  }).catch(function () { /* widget stays hidden when the service is unreachable */ });

  function build(cfg) {
    var color = cfg.color || "#0f766e";
    var launcher = el("button", "width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;color:#fff;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,.25);background:" + color, "💬");
    launcher.setAttribute("aria-label", "Open chat");
    var panel = el("div", "display:none;flex-direction:column;width:min(360px,calc(100vw - 32px));height:min(480px,calc(100vh - 100px));background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.25);overflow:hidden;margin-bottom:12px");
    var head = el("div", "padding:12px 14px;color:#fff;font-weight:600;background:" + color, cfg.name || "Chat");
    var list = el("div", "flex:1;overflow-y:auto;padding:12px;background:#f6f7f8;display:flex;flex-direction:column;gap:8px");
    var form = el("form", "display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff");
    var input = el("input", "flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#111");
    input.setAttribute("placeholder", "Type your message…");
    input.setAttribute("maxlength", "2000");
    input.setAttribute("aria-label", "Message");
    var send = el("button", "padding:0 14px;border:0;border-radius:8px;color:#fff;cursor:pointer;background:" + color, "Send");
    send.setAttribute("type", "submit");
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(form);
    var wrap = el("div", "display:flex;flex-direction:column;align-items:flex-end");
    wrap.appendChild(panel);
    wrap.appendChild(launcher);
    root.appendChild(wrap);

    var seen = {};
    var since = null;
    function bubble(text, mine) {
      var b = el("div", "max-width:80%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word;" + (mine ? "align-self:flex-end;color:#fff;background:" + color : "align-self:flex-start;background:#fff;color:#111;border:1px solid #e5e7eb"), text);
      list.appendChild(b);
      list.scrollTop = list.scrollHeight;
    }
    bubble(cfg.greeting || "Hi! How can we help you?", false);

    function poll() {
      var url = api + "?visitorId=" + encodeURIComponent(visitorId) + (since ? "&since=" + encodeURIComponent(since) : "");
      fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || !d.messages) return;
        d.messages.forEach(function (m) {
          if (seen[m.id]) return;
          seen[m.id] = true;
          since = m.at;
          bubble(m.text, false);
        });
      }).catch(function () { /* try again next tick */ });
    }
    var timer = null;
    function toggle(open) {
      panel.style.display = open ? "flex" : "none";
      launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      if (open) { poll(); timer = timer || window.setInterval(poll, 4000); input.focus(); }
      else if (timer) { window.clearInterval(timer); timer = null; }
    }
    launcher.addEventListener("click", function () { toggle(panel.style.display === "none"); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      bubble(text, true);
      fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitorId, text: text }) })
        .then(function (r) { if (!r.ok) bubble(r.status === 429 ? "Please wait a moment before sending more messages." : "Message could not be sent. Please try again.", false); })
        .catch(function () { bubble("Message could not be sent. Please check your connection.", false); });
    });
  }
})();
