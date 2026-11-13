// Native boot: Looi Cloud by default (sign up, nothing to configure). Advanced: run on this phone with own keys, or a custom server.
(async function () {
  var CLOUD = "__LOOI_CLOUD_URL__"; if (CLOUD.indexOf("__") === 0) CLOUD = "";
  var C = window.Capacitor, PL = (C && C.Plugins) || {}, P = PL.Preferences;
  async function get(k) { if (!P) return null; var r = await P.get({ key: k }); return r && r.value; }
  async function set(k, v) { if (P) await P.set({ key: k, value: v }); }
  try { PL.StatusBar && PL.StatusBar.setBackgroundColor({ color: "#0b0b0d" }); PL.StatusBar && PL.StatusBar.setStyle({ style: "DARK" }); } catch (e) {}
  var device = await get("device");
  if (!device) { device = "d" + Math.random().toString(36).slice(2) + Date.now().toString(36); await set("device", device); }
  var mode = await get("mode"), server = await get("server");
  if (!mode && server) mode = "server"; // upgrade from the server-only build
  if (!mode && CLOUD) { mode = "server"; server = CLOUD; await set("mode", mode); await set("server", server); }
  function syncRunner(token) {
    if (mode !== "server") return;
    try { PL.BackgroundRunner.dispatchEvent({ label: "app.looi.agent.check", event: "looiCheck", details: { server: server, device: device, token: token == null ? (localStorage.getItem("looiToken") || "") : token } }); } catch (e) {}
  }
  window.__LOOI_TOKEN_SYNC__ = syncRunner;

  function start() {
    window.__LOOI__ = { server: mode === "server" ? server : "", device: device, native: true, mode: mode };
    try { PL.LocalNotifications.requestPermissions(); } catch (e) {}
    syncRunner();
    try { PL.SplashScreen && PL.SplashScreen.hide(); } catch (e) {}
    var s = document.createElement("script"); s.type = "module"; s.src = window.__LOOI_ENTRY__; document.body.appendChild(s);
  }
  window.__LOOI_CLOUD__ = CLOUD;
  window.__LOOI_SWITCH__ = async function (m) {
    if (m === "cloud" && CLOUD) { await set("mode", "server"); await set("server", CLOUD); }
    else if (m === "device") { await set("mode", "device"); await set("server", ""); }
    else { await set("mode", "choose"); await set("server", ""); }
    try { localStorage.removeItem("looiToken"); } catch (e) {}
    location.href = location.pathname; };
  if (mode === "device" || (mode === "server" && server)) return start();

  var root = document.getElementById("root");
  var css = "min-height:100dvh;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 60% at 50% 0%,#1a1d10 0%,#0b0b0d 55%);color:#f0efe9;font-family:Satoshi,system-ui,sans-serif;padding:28px";
  var card = "display:block;width:100%;text-align:left;padding:18px;border-radius:16px;border:1px solid #26262b;background:#121215;color:#f0efe9;margin-top:12px";
  root.innerHTML = '<div style="' + css + '"><div style="width:100%;max-width:400px">' +
    '<svg viewBox="0 0 32 32" width="44" height="44"><circle cx="16" cy="16" r="9" stroke="#D4FF3A" stroke-width="3.4" fill="none"/><circle cx="23.2" cy="8.8" r="3.6" fill="#D4FF3A" stroke="#0b0b0d" stroke-width="2"/></svg>' +
    '<h1 style="font-size:28px;line-height:1.15;margin:22px 0 8px;font-weight:800;letter-spacing:-.02em">Your 24/7 marketing agent.</h1>' +
    '<p style="color:#9b9ba3;font-size:15px;margin:0 0 18px">Where should Looi run?</p>' +
    (CLOUD ? '<button id="cld" style="' + card + ';border-color:#D4FF3A55"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">Looi Cloud</b><span style="font-size:11px;font-weight:700;background:#D4FF3A;color:#0b0b0d;border-radius:99px;padding:3px 8px">RECOMMENDED</span></div><div style="color:#9b9ba3;font-size:13px;margin-top:6px">Free trial, no API keys. Runs 24/7 in the cloud even when your phone is off.</div></button>' : '') +
    '<button id="dev" style="' + card + (CLOUD ? '' : ';border-color:#D4FF3A55') + '"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">Run on this phone</b>' + (CLOUD ? '' : '<span style="font-size:11px;font-weight:700;background:#D4FF3A;color:#0b0b0d;border-radius:99px;padding:3px 8px">RECOMMENDED</span>') + '</div>' +
    '<div style="color:#9b9ba3;font-size:13px;margin-top:6px">No server. Audits, ads, publishing and background checks all happen on your device with your own free API keys.</div></button>' +
    '<button id="srv" style="' + card + '"><b style="font-size:16px">Connect to a Looi server</b><div style="color:#9b9ba3;font-size:13px;margin-top:6px">For teams or always-on cloud runs. You host it (Docker).</div></button>' +
    '<form id="f" style="display:none;margin-top:14px"><input id="u" type="url" required placeholder="https://looi.yourdomain.com" style="width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #26262b;background:#0e0e11;color:#fff;font-size:16px"/>' +
    '<p id="e" style="color:#f87171;font-size:13px;min-height:18px;margin:8px 0"></p>' +
    '<button style="width:100%;padding:14px;border-radius:12px;border:0;background:#D4FF3A;color:#0b0b0d;font-weight:700;font-size:15px">Connect</button></form>' +
    '</div></div>';
  if (CLOUD) document.getElementById("cld").onclick = async function () { mode = "server"; server = CLOUD; await set("mode", mode); await set("server", server); root.innerHTML = ""; start(); };
  document.getElementById("dev").onclick = async function () { mode = "device"; await set("mode", "device"); root.innerHTML = ""; start(); };
  document.getElementById("srv").onclick = function () { document.getElementById("f").style.display = "block"; document.getElementById("u").focus(); };
  document.getElementById("f").onsubmit = async function (ev) {
    ev.preventDefault();
    var u = document.getElementById("u").value.replace(/\/$/, "");
    try {
      var r = await fetch(u + "/api/health"); var j = await r.json(); if (!j.ok) throw 0;
      server = u; mode = "server"; await set("server", u); await set("mode", "server");
      root.innerHTML = ""; start();
    } catch (e) { document.getElementById("e").textContent = "Couldn't reach a Looi server at that URL."; }
  };
})();
