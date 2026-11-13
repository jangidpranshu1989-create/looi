/** Tiny admin screen for Looi Free payments: /admin (key = LOOI_ADMIN_TOKEN). */
export const ADMIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Looi · Payments admin</title><meta name="robots" content="noindex">
<style>
:root{--bg:#0b0b0d;--card:#141417;--b:#26262b;--fg:#f4f4f5;--mut:#9a9aa3;--p:#d4ff3a;--ok:#34d399;--bad:#f87171;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.w{max-width:980px;margin:0 auto;padding:24px 16px 60px}h1{font-size:20px;margin:0 0 4px}p.s{color:var(--mut);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--b);border-radius:14px;padding:16px}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
input{background:var(--bg);border:1px solid var(--b);color:var(--fg);border-radius:10px;padding:10px 12px;font:inherit;min-width:0;flex:1}
button{background:var(--p);color:#0b0b0d;border:0;border-radius:10px;padding:9px 14px;font:600 13px/1 inherit;cursor:pointer}button.g{background:transparent;color:var(--fg);border:1px solid var(--b)}button.r{background:transparent;color:var(--bad);border:1px solid #4a2326}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.st b{display:block;font:600 22px/1.2 ui-monospace,monospace;margin-top:4px}.st span{color:var(--mut);font-size:12px}
.o{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--b)}.o:first-child{border-top:0}
.m{font-family:ui-monospace,monospace}.mut{color:var(--mut);font-size:12px}.pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--b)}
.submitted{color:var(--warn);border-color:#4a3d16}.paid{color:var(--ok);border-color:#164a37}.rejected{color:var(--bad);border-color:#4a2326}.created{color:var(--mut)}
@media(max-width:640px){.o{grid-template-columns:1fr 1fr}.stats{grid-template-columns:1fr 1fr 1fr}}
</style></head><body><div class="w">
<h1>Payments</h1><p class="s">Match the amount (with paise) and UTR against your UPI app history (8529418454@fam), then approve. Approve = 30 days. Reject = plan switched off.</p>
<div class="card row" id="login"><input id="k" type="password" placeholder="Admin key" autocomplete="off"><button onclick="save()">Open</button></div>
<div id="main" style="display:none"><div class="stats"><div class="card st"><span>Waiting for you</span><b id="s1">0</b></div><div class="card st"><span>Paying (verified)</span><b id="s2">0</b></div><div class="card st"><span>Revenue (₹)</span><b id="s3">0</b></div></div>
<div class="row" style="margin-bottom:10px"><button class="g" onclick="load()">Refresh</button><button class="g" onclick="localStorage.removeItem('lk');location.reload()">Sign out</button></div>
<div class="card" id="list"></div></div>
<script>
const $=id=>document.getElementById(id);let K=localStorage.getItem('lk')||'';
function save(){K=$('k').value.trim();localStorage.setItem('lk',K);load()}
const t=ms=>ms?new Date(ms).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'–';
async function api(p,m){const r=await fetch('/relay/admin'+p,{method:m||'GET',headers:{'x-looi-admin':K}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||r.status);return j}
async function load(){try{const d=await api('/orders');$('login').style.display='none';$('main').style.display='';$('s1').textContent=d.stats.pending;$('s2').textContent=d.stats.paying;$('s3').textContent=d.stats.revenueInr.toLocaleString('en-IN');
$('list').innerHTML=d.orders.length?d.orders.map(o=>'<div class="o"><div><div class="m">₹'+o.amountInr+' · '+o.plan.toUpperCase()+'</div><div class="mut">'+o.orderId+' · '+t(o.createdAt)+'</div></div><div><div class="mut">UTR</div><div class="m">'+(o.utr||'–')+'</div></div><div><span class="pill '+o.status+'">'+(o.status==='submitted'?(o.provisional?'check · on for 48h':'check'):o.status)+'</span><div class="mut">'+t(o.utrAt)+'</div></div><div class="row">'+(o.status==='submitted'||o.status==='rejected'?'<button onclick="act(\\''+o.orderId+'\\',\\'approve\\')">Approve</button>':'')+(o.status==='submitted'?'<button class="r" onclick="act(\\''+o.orderId+'\\',\\'reject\\')">Reject</button>':'')+'</div></div>').join(''):'<p class="mut">No orders yet.</p>'}catch(e){$('login').style.display='';$('main').style.display='none';if(K)alert(e.message)}}
async function act(id,a){if(a==='reject'&&!confirm('Reject '+id+'? The plan will be switched off.'))return;try{await api('/orders/'+id+'/'+a,'POST');load()}catch(e){alert(e.message)}}
if(K)load();
</script></div></body></html>`;
