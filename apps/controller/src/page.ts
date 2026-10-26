import { POLICY } from "./policy.js";

// A small protected control page, served without the Static Assets router so
// Cloudflare's authenticated Access context remains available to the gateway.
export function controlPage(): Response {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TerraReady · Demo session</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f3ee;color:#20382f;font:17px/1.55 system-ui,sans-serif}
main{max-width:620px;margin:8vh auto;padding:24px}header{font-weight:700;letter-spacing:.08em;font-size:14px}
h1{font-size:38px;line-height:1.15;margin:32px 0 16px}p{margin:12px 0}.card{background:white;border:1px solid #cfd6ce;border-radius:16px;padding:24px;margin:28px 0}
h2{font-size:19px;margin:0 0 12px}button,a.button{font:inherit;display:inline-block;background:#244e3d;color:white;border:0;border-radius:8px;padding:12px 18px;text-decoration:none;cursor:pointer;margin:8px 8px 0 0}
button:disabled{opacity:.55;cursor:default}.secondary{background:transparent;color:#244e3d;box-shadow:inset 0 0 0 1px #829689}
button:focus-visible,a:focus-visible{outline:3px solid #bf7d1c;outline-offset:4px}[hidden]{display:none!important}.muted{color:#52635a;font-size:15px}#error{color:#8c3026}
.startup{margin:24px 0 16px;padding:24px;background:#e9eee4;border-radius:12px}.startup ol{list-style:none;padding:0;margin:16px 0}.startup li{display:flex;gap:12px;align-items:baseline;padding:8px 0}.step-mark{width:22px;flex-shrink:0;text-align:center;color:#52635a}.startup li[data-state="current"]{font-weight:650}.startup li[data-state="done"] .step-mark{color:#244e3d}.startup small{font-weight:400;color:#52635a}.startup-meta{font-size:14px;color:#52635a;font-variant-numeric:tabular-nums}.workspace-skeleton{border-top:1px solid #c7d1c1;margin-top:20px;padding-top:20px;display:grid;gap:10px}.skeleton-line{height:9px;background:#cfd9c8;border-radius:3px;animation:pulse 1.7s ease-in-out infinite}.skeleton-line:nth-child(2){width:72%}.skeleton-line:nth-child(3){width:45%}@keyframes pulse{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.skeleton-line{animation:none}}
</style></head><body><main>
<header>TERRAREADY / LIVE DEMO</header>
<h1 id="title">Checking the demo…</h1>
<p id="description" aria-live="polite">Getting the current session status.</p>
<p id="deadline" class="muted"></p>
<section id="startup" class="startup" aria-labelledby="startup-title" hidden>
<h2 id="startup-title">Getting your workspace ready</h2>
<ol aria-label="Startup progress">
<li id="allocation"><span id="allocation-mark" class="step-mark" aria-hidden="true">1</span><span>Get a GPU <small id="allocation-status"></small></span></li>
<li id="preparation"><span class="step-mark" aria-hidden="true">2</span><span>Prepare model and workspace <small id="preparation-status"></small></span></li>
<li><span class="step-mark" aria-hidden="true">3</span><span>Ready to open <small>Next</small></span></li></ol>
<p id="startup-detail" class="muted" aria-live="polite"></p>
<p class="startup-meta"><span id="elapsed"></span> · <span id="last-check"></span></p>
<div class="workspace-skeleton" aria-hidden="true"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
</section>
<div id="actions"><button id="start" hidden>Start live demo</button><button id="open" hidden>Open shift workspace</button><button id="stop" class="secondary" hidden>End shared session</button></div>
<p id="error" role="alert"></p><button id="retry" class="secondary" hidden>Check again</button>
<section class="card" aria-labelledby="budget"><h2 id="budget">One shared budget</h2>
<p>$${(POLICY.daily / 1_000_000).toFixed(2)} per Los Angeles calendar day, shared across everyone and every run. The project also has a $${POLICY.lifetime / 1_000_000} lifetime limit.</p>
<p>Each session lasts up to two hours from its first use and ends after thirty idle minutes. Setup and idle time use the budget; a cost limit can end a session sooner.</p>
<p id="remaining" class="muted"></p></section>
<p class="muted">Synthetic site data · Real model when running · Camera integration is a demo stub.</p>
<p class="muted">Your planning decisions stay in your own workspace for this run. Ending the shared session ends access for everyone. Return to <a href="/demo">this page</a> to check or end the session.</p>
<p class="muted"><a href="/owner">Owner controls</a></p>
</main><script nonce="${nonce}">
const $=id=>document.getElementById(id);const api=location.pathname.startsWith("/owner")?"/owner/api":"/api";let busy=false;let checking=false;let phase="off";let startingUntil=0;let checkedAt=0;let elapsedMs=0;let lastPollAt=0;
const states={off:['Start the live demo','Start when you are ready. No sign-in, invitation or appointment is needed. Your choices stay in this browser.'],reserved:['Starting the demo','Cold starts can take a few minutes. This page updates automatically.'],ready:['Demo is ready','Open the workspace to begin the shared session.'],active:['Demo is running','Join the current session. Everyone shares its remaining time and budget.'],stopping:['Ending the session','New work is paused while GPU shutdown is confirmed.'],terminated:['Preparing the next session','The GPU is off. Its budget reservation is being checked before another run.']};
function timers(){if($('startup').hidden)return;const age=Math.max(0,Date.now()-checkedAt);const seconds=Math.floor((elapsedMs+age)/1000);$('elapsed').textContent='Elapsed '+Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s';$('last-check').textContent=age<2000?'Status checked just now':'Status checked '+Math.floor(age/1000)+'s ago';}
function startup(s){$('startup').hidden=s.phase!=='reserved'||s.accountingHold;if($('startup').hidden)return;elapsedMs=s.startup?.elapsedMs??0;const stage=s.startup?.stage??'allocating';const allocated=stage==='preparing';$('allocation').dataset.state=allocated?'done':'current';$('preparation').dataset.state=allocated?'current':'pending';for(const id of ['allocation','preparation']){if($(id).dataset.state==='current')$(id).setAttribute('aria-current','step');else $(id).removeAttribute('aria-current');}$('allocation-mark').textContent=allocated?'✓':'1';$('allocation-status').textContent=allocated?'Allocated':stage==='confirming'?'Confirming request':stage==='requesting'?'Sending request':'Waiting for allocation';$('preparation-status').textContent=allocated?'In progress':'Next';$('startup-detail').textContent=allocated?'Preparing the app, model files and readiness checks. No action needed.':stage==='confirming'?'Checking the original GPU request before proceeding. We will not start a second GPU.':'Waiting for the provider to confirm a GPU. No action needed.';timers();}
async function update(){
 if(checking)return;checking=true;lastPollAt=Date.now();
 try{const r=await fetch(api+'/status',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();if(!states[s.phase])throw Error();
 checkedAt=Date.now();startup(s);
 phase=s.phase;const state=s.accountingHold?['Demo is paused','The owner needs to resolve a budget check before another run.']:states[s.phase];
 $('title').textContent=state[0];$('description').textContent=state[1];$('error').textContent='';$('retry').hidden=true;
 $('start').hidden=s.phase!=='off'||s.accountingHold;$('start').disabled=busy||!s.startupEnabled;
 if(s.phase==='off'&&!s.startupEnabled)$('description').textContent='Setup is being finished. GPU startup is not available yet.';
 $('open').hidden=!['ready','active'].includes(s.phase)||s.accountingHold;$('open').disabled=busy;
 $('stop').hidden=!s.owner||!['reserved','ready','active'].includes(s.phase);$('stop').disabled=busy;
 $('retry').hidden=s.phase!=='off';const end=Math.min(s.activeEndAt??Infinity,s.costStopAt??Infinity,s.idleEndAt??Infinity);$('deadline').textContent=Number.isFinite(end)?'Session ends no later than '+new Date(end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.':'';
 $('remaining').textContent='Available for a new run: $'+s.dailyAvailable.toFixed(2)+' today · $'+s.lifetimeAvailable.toFixed(2)+' across the project.';
 }catch{$('startup').hidden=true;$('title').textContent='Session status unavailable';$('description').textContent='We could not check the session. It may still be starting. Check again.';$('retry').hidden=false;for(const id of ['start','open','stop'])$(id).hidden=true;}finally{checking=false;}
}
async function action(name){if(busy)return;if(name==="start"){startingUntil=Date.now()+30000;checkedAt=Date.now();$('title').textContent='Starting the demo';$('description').textContent='Sending your start request…';startup({phase:'reserved',startup:{stage:'requesting',elapsedMs:0}});}busy=true;let failed=false;for(const id of ['start','open','stop'])$(id).disabled=true;
 try{const r=await fetch(api+'/'+name,{method:'POST'});if(!r.ok)throw Error();if(name==='open'){const s=await r.json();if(!s.accepted)throw Error();location.assign('/');return;}}
 catch{failed=true;}
 finally{busy=false;await update();if(failed)$('error').textContent='That action could not finish. Check the session status before retrying.';}
}
for(const name of ['start','open','stop'])$(name).onclick=()=>action(name);$('retry').onclick=update;update();setInterval(timers,1000);setInterval(()=>{if(document.hidden||busy)return;if(phase==='reserved'||Date.now()<startingUntil||(['ready','active','stopping','terminated'].includes(phase)&&Date.now()-lastPollAt>=15000))update()},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});window.addEventListener('focus',()=>{if(!busy)update()});
</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      },
    },
  );
}
