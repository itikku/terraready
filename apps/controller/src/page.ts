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
</style></head><body><main>
<header>TERRAREADY / PRIVATE DEMO</header>
<h1 id="title">Checking the demo…</h1>
<p id="description" aria-live="polite">Getting the current session status.</p>
<p id="deadline" class="muted"></p>
<div id="actions"><button id="start" hidden>Start demo</button><button id="open" hidden>Open shift workspace</button><button id="stop" class="secondary" hidden>End shared session</button></div>
<p id="error" role="alert"></p><button id="retry" class="secondary" hidden>Check again</button>
<section class="card" aria-labelledby="budget"><h2 id="budget">One shared budget</h2>
<p>$1.50 per Los Angeles calendar day, shared across everyone and every run. The project also has a $5 lifetime limit.</p>
<p>Each session lasts up to two hours from its first use and ends after ten idle minutes. Setup and idle time use the budget; a cost limit can end a session sooner.</p>
<p id="remaining" class="muted"></p></section>
<p class="muted">Synthetic site data · Real model when running · Camera integration is a demo stub.</p>
<p class="muted">Your planning decisions stay in your own workspace for this run. Ending the shared session ends access for everyone. Return to <a href="/demo">this page</a> to check or end the session.</p>
</main><script nonce="${nonce}">
const $=id=>document.getElementById(id);let busy=false;
const states={off:['Demo is off','The owner can start a session when setup and budget checks are complete.'],reserved:['Starting the demo','The GPU is loading the model. You can leave this page open.'],ready:['Demo is ready','Open the workspace to begin the shared session.'],active:['Demo is running','Join the current session. Everyone shares its remaining time and budget.'],stopping:['Ending the session','New work is paused while GPU shutdown is confirmed.'],terminated:['GPU is off','The final provider charge is being checked before another run.']};
async function update(){
 try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();if(!states[s.phase])throw Error();
 const state=s.accountingHold?['Demo is paused','The owner needs to resolve a budget check before another run.']:states[s.phase];
 $('title').textContent=state[0];$('description').textContent=state[1];$('error').textContent='';$('retry').hidden=true;
 $('start').hidden=!s.owner||s.phase!=='off'||s.accountingHold;$('start').disabled=busy||!s.startupEnabled;
 if(s.owner&&s.phase==='off'&&!s.startupEnabled)$('description').textContent='Setup is being finished. GPU startup is not available yet.';
 $('open').hidden=!['ready','active'].includes(s.phase)||s.accountingHold;$('open').disabled=busy;
 $('stop').hidden=!s.owner||!['reserved','ready','active'].includes(s.phase);$('stop').disabled=busy;
 const end=Math.min(s.activeEndAt??Infinity,s.costStopAt??Infinity);$('deadline').textContent=Number.isFinite(end)?'Session ends no later than '+new Date(end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.':'';
 $('remaining').textContent='Available for a new run: $'+s.dailyAvailable.toFixed(2)+' today · $'+s.lifetimeAvailable.toFixed(2)+' across the project.';
 }catch{$('title').textContent='Session status unavailable';$('description').textContent='Check again or reload this page to sign in.';$('retry').hidden=false;for(const id of ['start','open','stop'])$(id).hidden=true;}
}
async function action(name){if(busy)return;busy=true;let failed=false;for(const id of ['start','open','stop'])$(id).disabled=true;
 try{const r=await fetch('/api/'+name,{method:'POST'});if(!r.ok)throw Error();if(name==='open'){const s=await r.json();if(!s.accepted)throw Error();location.assign('/');return;}}
 catch{failed=true;}
 finally{busy=false;await update();if(failed)$('error').textContent='That action could not finish. Check the session status before retrying.';}
}
for(const name of ['start','open','stop'])$(name).onclick=()=>action(name);$('retry').onclick=update;update();setInterval(update,5000);
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
