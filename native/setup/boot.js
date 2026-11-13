// Native boot: resolve server URL + device id from Capacitor Preferences, then load the Looi app.
(async function () {
  var C = window.Capacitor, P = C && C.Plugins && C.Plugins.Preferences;
  async function get(k) { if (!P) return null; var r = await P.get({ key: k }); return r && r.value; }
  async function set(k, v) { if (P) await P.set({ key: k, value: v }); }
  var device = await get("device");
  if (!device) { device = "d" + Math.random().toString(36).slice(2) + Date.now().toString(36); await set("device", device); }
  var server = await get("server");
  function start() {
    window.__LOOI__ = { server: server, device: device, native: true };
    try { C.Plugins.LocalNotifications.requestPermissions(); } catch (e) {}
    try { C.Plugins.BackgroundRunner.dispatchEvent({ label: "app.looi.agent.check", event: "looiCheck", details: { server: server, device: device } }); } catch (e) {}
    var s = document.createElement("script"); s.type = "module"; s.src = window.__LOOI_ENTRY__; document.body.appendChild(s);
  }
  if (server) return start();
  var root = document.getElementById("root");
  root.innerHTML = '<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#f0efe9;font-family:Satoshi,system-ui,sans-serif;padding:24px">' +
    '<form id="f" style="width:100%;max-width:380px">' +
    '<svg viewBox="0 0 32 32" width="40" height="40"><circle cx="16" cy="16" r="9" stroke="#D4FF3A" stroke-width="3.4" fill="none"/><circle cx="23.2" cy="8.8" r="3.6" fill="#D4FF3A" stroke="#0b0b0d" stroke-width="2"/></svg>' +
    '<h1 style="font-size:24px;margin:20px 0 6px;font-weight:800">Connect to your Looi server</h1>' +
    '<p style="color:#9b9ba3;font-size:14px;margin:0 0 20px">The agent runs 24/7 on your server. Enter its URL.</p>' +
    '<input id="u" type="url" required placeholder="https://looi.yourdomain.com" style="width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #26262b;background:#121215;color:#fff;font-size:16px"/>' +
    '<p id="e" style="color:#f87171;font-size:13px;min-height:18px"></p>' +
    '<button style="width:100%;padding:14px;border-radius:12px;border:0;background:#D4FF3A;color:#0b0b0d;font-weight:700;font-size:15px">Connect</button></form></div>';
  document.getElementById("f").onsubmit = async function (ev) {
    ev.preventDefault();
    var u = document.getElementById("u").value.replace(/\/$/, "");
    try {
      var r = await fetch(u + "/api/health"); var j = await r.json(); if (!j.ok) throw 0;
      server = u; await set("server", u);
      root.innerHTML = ""; start();
    } catch (e) { document.getElementById("e").textContent = "Couldn't reach a Looi server at that URL."; }
  };
})();
