// Browser integration verification; no real model, credentials or production access.
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Store } from './store.mjs';
import { ProjectRegistry } from './projects.mjs';
import { loadConfig } from './config.mjs';
import { Workspace } from './workspace.mjs';
import { SimulationProvider } from './provider.mjs';
import { Engine } from './engine.mjs';
import { createApp } from './server.mjs';
import { passwordHash } from './auth.mjs';
const {chromium}=await import(process.env.AD507_PLAYWRIGHT_MODULE||'playwright');
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const root=await mkdtemp(join(tmpdir(),'ad507-browser-'));const password='ad507-browser-fixture-password';
const config=loadConfig({AD507_PROVIDER:'simulation',AD507_DATA_DIR:root,AD507_OWNER_PASSWORD_HASH:passwordHash(password),AD507_ORIGIN:`http://127.0.0.1:${port}`});
const store=new Store(root);config.registry=new ProjectRegistry(config,store);const workspace=new Workspace(config),engine=new Engine(config,store,workspace,new SimulationProvider());
const app=createApp(config,store,engine);app.listen(port,'127.0.0.1');await once(app,'listening');
const worker=setInterval(()=>engine.tick(),50);
let browser;try{
  let launch={headless:true};
  if(process.env.AD507_CHROMIUM_MODULE){const {default:bundled}=await import(process.env.AD507_CHROMIUM_MODULE);launch={...launch,executablePath:await bundled.executablePath(),args:bundled.args.filter(arg=>arg!=='--disable-web-security')};}
  browser=await chromium.launch(launch);const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)console.log('API',r.status(),r.url());});
  await page.setViewportSize({width:390,height:844});await page.goto(config.origin);
  await page.locator('#password').fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#project option').count(),5);
  await page.locator('#project-registration summary').click();await page.locator('#project-id').fill('browser-project');await page.locator('#project-name').fill('Proyecto autorizado desde tablet');await page.locator('#project-consent').check();await page.getByRole('button',{name:'Registrar proyecto autorizado',exact:true}).click();await page.locator('#project option[value=browser-project]').waitFor({state:'attached'});assert.equal(await page.locator('#project option').count(),Object.keys(loadConfig({}).projects).length+1);await page.locator('#project-registration summary').click();
  await page.locator('#project').selectOption('junta-comunal-santiago');await page.locator('#instructions').fill('Preparar documentación institucional sin construir la web.');
  await page.getByRole('button',{name:'Crear e iniciar trabajo'}).click();await page.locator('#task-state').filter({hasText:'Esperando aprobación'}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'docs/ad507-simulation.md',exact:true}).click();await page.locator('#file-content').waitFor({state:'visible'});assert.match(await page.locator('#file-content').innerText(),/AD507 Developer/);
  for(const size of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768}]){
    await page.setViewportSize(size);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
    const measurements=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,buttonHeight:document.querySelector('#task-form button').getBoundingClientRect().height}));
    assert.ok(measurements.width<=size.width,`overflow at ${size.width}: ${measurements.width}`);assert.ok(measurements.buttonHeight>=44);
    if(process.env.AD507_QA_DIR){await mkdir(process.env.AD507_QA_DIR,{recursive:true});await page.screenshot({path:join(process.env.AD507_QA_DIR,`panel-${size.width}.png`),fullPage:true});}
    console.log(`PASS panel ${size.width}x${size.height}: no horizontal overflow, touch target >=44px, authenticated task and file visible`);
  }
  await page.getByRole('button',{name:'Aprobar entrega',exact:true}).click();await page.locator('#task-state').filter({hasText:'Completado'}).waitFor();
  config.registry.register({id:'junta-web',name:'Junta Comunal de Santiago · repositorio',repository:'direcciones507/Junta-Comunal-Santiago',mode:'development',authorize:true});
  await page.reload();await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#project').inputValue(),'junta-web');assert.equal(await page.locator('#project option[value=junta-comunal-santiago]').isDisabled(),true);
  console.log('PASS registered repository replaces ambiguous local preparation default; history remains accessible');
  await page.getByRole('button',{name:'Cerrar sesión'}).click();await page.locator('#login').waitFor({state:'visible'});assert.deepEqual(errors,[]);console.log('PASS create -> simulate -> inspect -> approve -> logout; zero browser errors');
}catch(err){console.error('BROWSER_FAILURE',err.message);throw err;}finally{clearInterval(worker);await engine.stop();await browser?.close();await new Promise(r=>app.close(r));store.close();await rm(root,{recursive:true,force:true});}
