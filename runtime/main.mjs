import { loadConfig } from './config.mjs';
import { ProjectRegistry } from './projects.mjs';
import { Store } from './store.mjs';
import { Workspace } from './workspace.mjs';
import { ActionsChecks } from './actions-checks.mjs';
import { Provider,SimulationProvider } from './provider.mjs';
import { Publisher } from './publisher.mjs';
import { Engine } from './engine.mjs';
import { createApp } from './server.mjs';
const c=loadConfig();const s=new Store(c.root);c.registry=new ProjectRegistry(c,s);const w=new Workspace(c);
if(c.checkBackend==='github-actions')w.remote=new ActionsChecks(c,s,w);
const e=new Engine(c,s,w,c.provider==='simulation'?new SimulationProvider():new Provider(c),new Publisher(c,w));
let app;try{app=createApp(c,s,e);}catch(err){s.close();throw err;}
const timer=setInterval(()=>e.tick().catch(()=>console.error('WORKER_TICK_FAILED')),500);
let reconciling=false;const remoteTimer=setInterval(async()=>{if(!w.remote||reconciling)return;reconciling=true;try{await w.remote.reconcile();}catch{console.error('REMOTE_RECONCILE_FAILED');}finally{reconciling=false;}},30000);
app.requestTimeout=15000;app.headersTimeout=10000;
app.listen(c.port,c.host,()=>console.log(`AD507 Developer listening: ${c.origin} (provider=${c.provider}; live=${c.live})`));
let closing=false;async function stop(){if(closing)return;closing=true;clearInterval(timer);clearInterval(remoteTimer);const closed=new Promise(resolve=>app.close(resolve));await e.stop();await closed;while(reconciling)await new Promise(resolve=>setTimeout(resolve,10));s.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
