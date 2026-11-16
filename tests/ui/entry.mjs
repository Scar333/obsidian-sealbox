import { Platform } from 'obsidian';
import { SecretsModal } from '../../src/secrets/modal.ts';
import { SecretsStore } from '../../src/secrets/store.ts';
import { VaultSession } from '../../src/crypto/session.ts';
import { newEntry, emptyDb, upsert } from '../../src/secrets/model.ts';
import { setLanguage } from '../../src/i18n/index.ts';
import { askPassword } from '../../src/ui/password-modal.ts';
import { quickAddSecret } from '../../src/secrets/quick-add.ts';
import { ShowRecoveryKeyModal, RecoveryHelpModal } from '../../src/ui/recovery-modals.ts';
import { generateRecoveryKey } from '../../src/crypto/recovery.ts';
import { SealedView } from '../../src/views/sealed-view.ts';

let host, store, modal;
window.setup = async ({mobile = false, lang = 'ru'} = {}) => {
  document.querySelectorAll('.modal-container').forEach(e=>e.remove());
  Platform.isMobile=mobile;
  setLanguage(lang);
  window.notices=[];
  let db=emptyDb();
  db=upsert(db,newEntry({id:'first', title:'Почта · Personal', username:'demo@example.com',password:'demo-secret',urls:['https://example.com'], group:'Личное',note:'Демонстрационные данные'}));
  db=upsert(db,newEntry({id:'second',title:'Длинное название сервера для проверки переноса текста',username:'admin',password:'fake-pass',group:'Работа'}));
  const session=new VaultSession({autoLockMs:0}); session.unlock({});
  window.failSave=false;window.writeCount=0;
  const files=new Map();
  host={settings:{clipboardClearSeconds:30,secretsPath:'Secrets.sealed'},controller:{session,async ensureUnlocked(){return session.requireKey();},get isUnlocked(){return session.isUnlocked;},lock(){session.lock();}},app:{vault:{adapter:{async exists(p){return files.has(p);},async readBinary(p){return files.get(p);},async writeBinary(p,v){files.set(p,v);}}}},ops:{async writeSealed(_p,payload){window.writeCount++;window.disabledDuringSave=[...document.querySelectorAll(".sealbox-pane-detail input")].every(el=>el.disabled);await new Promise(r=>setTimeout(r,50));if(window.failSave)throw new Error('simulated disk failure'); db=JSON.parse(new TextDecoder().decode(payload));}}};
  store=new SecretsStore(host);
  await store.update(()=>db);
  window.writeCount=0;
  window.modal=modal=new SecretsModal(host.app,host,store,'first');modal.open();
  window.host=host;window.store=store;
};
window.openPassword=()=>{ askPassword(host.app,{title:'Создайте мастер-пароль', confirm:true,showStrength:true,submitLabel:'Создать'}); };
window.openQuickAdd=()=>quickAddSecret(host.app,host,store);
window.checkConcurrent=async()=>{
  await Promise.all([store.update(db=>upsert(db,newEntry({id:'concurrent-a'}))),store.update(db=>upsert(db,newEntry({id:'concurrent-b'})))]);
  const db=await store.load();
  return ['concurrent-a','concurrent-b'].every(id=>db.entries.some(e=>e.id===id));
};
window.checkLateStore=async()=>{
  store.forget();
  host.app.vault.adapter.exists=async()=>true;
  let finish; const pending=new Promise(r=>finish=r);
  host.ops.readSealedAtPath=async()=>pending;
  const task=store.load();await Promise.resolve();host.controller.lock();
  const data=new TextEncoder().encode(JSON.stringify(emptyDb()));finish({data});
  await task.catch(()=>{});
  return store.db===null && data.every(x=>x===0);
};
window.checkLateView=async()=>{
  const session=new VaultSession({autoLockMs:0});session.unlock({});
  let finish;const pending=new Promise(r=>finish=r);
  const viewHost={controller:{session,get isUnlocked(){return session.isUnlocked;}},ops:{readSealed:async()=>pending}};
  const view=new SealedView({app:{}},viewHost);await view.onOpen();
  const task=view.onLoadFile({basename:'test',stat:{size:1}});
  session.lock();
  const data=new TextEncoder().encode('must never appear');
  finish({data,meta:{name:'private.txt',mime:'text/plain',size:data.length}});
  await task;
  const safe=view.plain===null && data.every(x=>x===0) && !view.contentEl.textContent.includes('must never appear');
  await view.onClose();view.contentEl.remove();return safe;
};

window.checkRecoveryClose=async()=>{
  const generated=await generateRecoveryKey();
  const dialog=new ShowRecoveryKeyModal(host.app,generated.display);dialog.open();
  await new Promise(r=>setTimeout(r,20));
  const expected=dialog.expected;dialog.close();
  return dialog.expected===null && dialog.displayKey==='' && expected.every(x=>x===0);
};

window.openRecoveryHelp=()=>new RecoveryHelpModal(host.app,'.obsidian/plugins/sealbox/keyring.json').open();
