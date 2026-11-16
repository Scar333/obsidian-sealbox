/** Optional visual/behaviour review in Chromium using actual plugin components.
 * Set SEALBOX_PLAYWRIGHT to playwright-core's index.mjs, SEALBOX_BROWSER to Chromium.
 * Host chrome is a small adapter, not a running Obsidian instance.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'dist/ui-review');await mkdir(out,{recursive:true});
let css;
if(process.env.SEALBOX_OBSIDIAN_CSS) css=await readFile(process.env.SEALBOX_OBSIDIAN_CSS,'utf8');
else {
  const data=await readFile('/usr/lib/obsidian/obsidian.asar');
  const header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12)).toString());
  const entry=header.files['app.css'];const start=8+data.readUInt32LE(4)+Number(entry.offset);
  css=data.subarray(start,start+entry.size).toString();
}
await writeFile(resolve(out,'obsidian.css'),css);
await writeFile(resolve(out,'styles.css'),await readFile(resolve(root,'styles.css')));
await build({entryPoints:[resolve(root,'tests/ui/entry.mjs')],outfile:resolve(out,'review.js'),bundle:true,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'review-adapter',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:resolve(root,'tests/ui/obsidian.mjs')}));b.onResolve({filter:/^sealbox:pdf-worker$/},()=>({path:'worker',namespace:'review'}));b.onLoad({filter:/.*/,namespace:'review'},()=>({contents:'export default ""'}));}}]});
await writeFile(resolve(out,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="obsidian.css"><link rel="stylesheet" href="styles.css"><body class="theme-dark"><script src="review.js"></script>');
const flag=(name)=>process.argv[process.argv.indexOf(name)+1];
const modulePath=process.argv.includes('--playwright') ? flag('--playwright') : process.env.SEALBOX_PLAYWRIGHT;
const browserPath=process.argv.includes('--browser') ? flag('--browser') : process.env.SEALBOX_BROWSER;
const pw=await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser=await pw.chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox']});
const report=[];
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve(out,'index.html')).href);
  for(const theme of ['dark','light']) for(const width of [1440,760,390,320]) {
    await page.setViewportSize({width,height:960});
    await page.evaluate(async({theme,width})=>{document.body.className='theme-'+theme+(width<=390?' is-mobile':'');await window.setup({mobile:width<=390});},{theme,width});
    await page.locator('.sealbox-secrets-top').waitFor();
    const geometry=await page.evaluate(()=>{
      const add=document.querySelector('.sealbox-secrets-top > button').getBoundingClientRect();
      const x=document.querySelector('.modal-close-button').getBoundingClientRect();
      return {gap:add.top-x.bottom,overflow:document.documentElement.scrollWidth>innerWidth,
        panes:[...document.querySelectorAll('.sealbox-pane')].map(p=>({overflow:p.scrollWidth-p.clientWidth,visible:p.getBoundingClientRect().width>0}))};
    });
    assert.ok(geometry.gap>=20,JSON.stringify({theme,width,geometry}));
    assert.equal(geometry.overflow,false);
    assert.ok(geometry.panes.every(p=>!p.visible||p.overflow<=2),JSON.stringify({theme,width,geometry}));
    await page.screenshot({path:resolve(out,`secrets-${theme}-${width}.png`)});
    if(width<=390) {
      await page.locator('.sealbox-card').filter({hasText:'Почта'}).click();
      await page.screenshot({path:resolve(out,`detail-${theme}-${width}.png`)});
      assert.ok(await page.locator('.sealbox-pane-detail').evaluate(el=>el.scrollWidth-el.clientWidth<=2));
    }
    report.push({theme,width,...geometry});
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.body.className='theme-dark';return window.setup();});
  await page.locator('.sealbox-card').filter({hasText:'Длинное'}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.sealbox-card[aria-pressed="true"]')?.textContent.includes('Длинное'));
  const title=page.locator('.sealbox-pane-detail .sealbox-field input').first();
  await title.fill('Unsaved draft');
  await page.locator('.sealbox-card').filter({hasText:'Почта'}).click();
  await page.getByText('Есть несохранённые изменения',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.equal(await title.inputValue(),'Unsaved draft');
  await page.evaluate(()=>{window.failSave=true;window.notices=[];});
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>window.notices.some(x=>x.includes('simulated disk failure')));
  assert.equal(await title.inputValue(),'Unsaved draft');
  assert.ok(!await page.evaluate(()=>window.notices.some(x=>x==='Сохранено.')));
  await page.evaluate(()=>{window.failSave=false;window.writeCount=0;const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить');b.click();b.click();});
  await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
  assert.equal(await page.evaluate(()=>window.writeCount),1);
  assert.equal(await page.evaluate(()=>window.disabledDuringSave),true);
  assert.equal(await page.evaluate(()=>window.checkConcurrent()),true);
  assert.equal(await page.evaluate(()=>window.checkLateStore()),true);
  await page.evaluate(()=>window.setup());
  assert.equal(await page.evaluate(()=>window.checkLateView()),true);
  await page.evaluate(()=>window.setup());
  await page.evaluate(()=>{void window.openQuickAdd();});
  await page.locator('.sealbox-template').first().focus();await page.keyboard.press('Enter');
  const quick=page.locator('.sealbox-quickadd-modal');
  await quick.locator('input').first().fill('Draft quick entry');
  await page.screenshot({path:resolve(out,'quickadd-dark.png')});
  await quick.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.getByText('Есть несохранённые изменения',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Не сохранять',exact:true}).click();
  await quick.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.checkRecoveryClose()),true);
  await page.locator('.sealbox-pane-detail .sealbox-field input').first().fill('Unsaved on lock');
  await page.evaluate(()=>window.host.controller.lock());
  assert.ok(await page.evaluate(()=>window.notices.some(x=>x.includes('Несохранённые правки'))));
  await page.evaluate(()=>window.setup());
  await page.evaluate(()=>window.openRecoveryHelp());
  await page.screenshot({path:resolve(out,'recovery-help-dark.png')});
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.evaluate(()=>window.setup({lang:'en'}));
  await page.screenshot({path:resolve(out,'secrets-dark-en.png')});
  await page.evaluate(()=>window.openPassword());
  await page.screenshot({path:resolve(out,'password-dark.png')});
  assert.deepEqual(errors,[]);
  report.push({behaviour:'keyboard selection, unsaved cancel, failed save, double save, concurrent updates, late store/view lock results, quick-add discard, recovery-key cleanup',passed:true});
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
