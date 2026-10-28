import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const {indexedDB}=await import(process.env.FAKE_INDEXEDDB_PATH||'fake-indexeddb');
globalThis.indexedDB=indexedDB;
await import('../dist/core.js');
const T=globalThis.Trails;
const trail={id:'test-trail',name:'Test trail',city:'Test city',rating:4.75,description:'A testing-only review.',lat:41.23,lon:-81.51,distance:2.5};
async function envelope(trails){
  const {publicKey}=await T.keys(),pub=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']),aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  return {type:'hiking-trails-delivery',version:1,iv:T.b64(iv),key:T.b64(await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,await crypto.subtle.exportKey('raw',aes))),data:T.b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify({version:1,trails}))))};
}
test('local-first journal and delivery invariants',async t=>{
  await t.test('validates ratings, coordinates and distance',()=>{assert.equal(T.validate(trail).rating,4.75);for(const patch of [{rating:5.5},{rating:4.2},{lat:91},{lat:1,lon:null},{distance:-1},{distance:'oops'},{description:''}])assert.throws(()=>T.validate({...trail,...patch}));});
  await t.test('persists and edits a trail',async()=>{await T.write('trails',[T.validate(trail)]);assert.equal((await T.get('trails',trail.id)).name,trail.name);await T.write('trails',[T.validate({...trail,description:'Edited'})]);assert.equal((await T.get('trails',trail.id)).description,'Edited');});
  await t.test('hybrid encryption round trip and tamper rejection',async()=>{const env=await envelope([trail]);assert.equal((await T.decryptDelivery(env)).trails[0].name,trail.name);const bytes=T.un64(env.data);bytes[0]^=1;await assert.rejects(T.decryptDelivery({...env,data:T.b64(bytes)}));});
  await t.test('all-or-nothing validation before receipt',async()=>{await assert.rejects(T.ingest({version:1,trails:[{...trail,id:'must-not-save'},{...trail,name:''}]},'invalid'));assert.equal(await T.get('trails','must-not-save'),undefined);assert.equal(await T.get('receipts','invalid'),undefined);});
  await t.test('receipt prevents replay after a local delete',async()=>{assert.equal(await T.ingest({version:1,trails:[{...trail,id:'replay'}]},'replay-receipt'),1);await T.remove('trails','replay');assert.equal(await T.ingest({version:1,trails:[{...trail,id:'replay'}]},'replay-receipt'),0);assert.equal(await T.get('trails','replay'),undefined);});
  await t.test('encrypted backup restores identity and entries; wrong passwords reject',async()=>{const before=await T.keys(),backup=await T.backup('test-password-123');assert.ok(!JSON.stringify(backup).includes(trail.name));await assert.rejects(T.restore(backup,'wrong-password'));await T.remove('trails',trail.id);assert.ok(await T.restore(backup,'test-password-123')>=1);assert.equal((await T.get('trails',trail.id)).description,'Edited');assert.deepEqual((await T.keys()).publicKey,before.publicKey);assert.ok(await T.get('receipts','replay-receipt'));});
  await t.test('CLI delivery is compatible with phone decryptor',async()=>{const dir=await mkdtemp(join(tmpdir(),'trails-test-'));try{await writeFile(join(dir,'key.json'),JSON.stringify({type:'hiking-trails-public-key',version:1,publicKey:(await T.keys()).publicKey}));await writeFile(join(dir,'input.json'),JSON.stringify({version:1,trails:[trail]}));execFileSync(process.execPath,['scripts/create-delivery.mjs',join(dir,'key.json'),join(dir,'input.json'),join(dir,'output.json')],{cwd:new URL('..',import.meta.url)});assert.equal((await T.decryptDelivery(JSON.parse(await readFile(join(dir,'output.json'),'utf8')))).trails[0].name,trail.name);}finally{await rm(dir,{recursive:true,force:true});}});
  await t.test('GitHub cleanup follows durable import; failed cleanup retries without resurrection',async()=>{
    await T.write('settings',[{id:'github',repo:'test/repo',branch:'main',token:'test-only-token'}]);const env=await envelope([{...trail,id:'github-trail'}]);let failDelete=true,deletes=0,reads=0;
    globalThis.fetch=async(url,opts)=>{
      assert.equal(opts.cache,'no-store');assert.equal(opts.headers.Authorization,'Bearer test-only-token');
      if(opts.method==='DELETE'){deletes++;assert.ok(await T.get('receipts','test/repo/inbox/batch.json@sha1'));assert.equal(JSON.parse(opts.body).sha,'sha1');return new Response('{}',{status:failDelete?503:200});}
      if(url.includes('inbox?'))return Response.json([{name:'batch.json',path:'inbox/batch.json',type:'file',sha:'sha1'}]);
      reads++;return Response.json({sha:'sha1',encoding:'base64',size:1000,content:T.b64(new TextEncoder().encode(JSON.stringify(env)))});
    };
    const first=await T.syncInbox();assert.equal(first.count,1);assert.equal(first.errors.length,1);assert.ok(await T.get('trails','github-trail'));await T.remove('trails','github-trail');failDelete=false;const second=await T.syncInbox();assert.equal(second.count,0);assert.equal(second.removed,1);assert.equal(reads,1);assert.equal(deletes,2);assert.equal(await T.get('trails','github-trail'),undefined);
  });
  await t.test('malformed encrypted delivery is retained on GitHub',async()=>{let deleted=false;const env=await envelope([{...trail,rating:7}]);globalThis.fetch=async(url,opts)=>{if(opts.method==='DELETE'){deleted=true;return Response.json({});}if(url.includes('inbox?'))return Response.json([{name:'bad.json',path:'inbox/bad.json',type:'file',sha:'badsha'}]);return Response.json({sha:'badsha',encoding:'base64',size:1000,content:T.b64(new TextEncoder().encode(JSON.stringify(env)))});};const r=await T.syncInbox();assert.equal(r.count,0);assert.equal(r.errors.length,1);assert.equal(deleted,false);assert.equal(await T.get('receipts','test/repo/inbox/bad.json@badsha'),undefined);});
  await t.test('local database failure never deletes the remote file',async()=>{const d=await T.db(),original=d.transaction.bind(d),env=await envelope([{...trail,id:'failed-write'}]);let deleted=false;d.transaction=(stores,...args)=>{if(Array.isArray(stores))throw Error('Simulated storage failure');return original(stores,...args);};globalThis.fetch=async(url,opts)=>{if(opts.method==='DELETE'){deleted=true;return Response.json({});}if(url.includes('inbox?'))return Response.json([{name:'quota.json',path:'inbox/quota.json',type:'file',sha:'quota'}]);return Response.json({sha:'quota',encoding:'base64',size:1000,content:T.b64(new TextEncoder().encode(JSON.stringify(env)))});};try{const r=await T.syncInbox();assert.equal(r.errors.length,1);assert.equal(deleted,false);}finally{d.transaction=original;}});
});
test('PWA shell assets and form bindings are complete',async()=>{const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../dist/app.js',import.meta.url),'utf8'),sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const [,id]of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(id),'missing element '+id);for(const [,asset]of sw.matchAll(/'\.\/([^']+)'/g))await readFile(new URL('../dist/'+asset,import.meta.url));const manifest=JSON.parse(await readFile(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));assert.equal(manifest.display,'standalone');for(const icon of manifest.icons)assert.ok((await readFile(new URL('../dist/'+icon.src,import.meta.url))).length>100);});
test('map projection round-trip',async()=>{const context={globalThis:{}};vm.runInNewContext(await readFile(new URL('../dist/map.js',import.meta.url),'utf8'),context);const map=Object.create(context.globalThis.TrailMap.prototype);map.zoom=12;for(const [lat,lon]of [[41.23,-81.51],[0,0],[-33.8,151.2]]){const p=map.unproject(...map.project(lat,lon));assert.ok(Math.abs(p[0]-lat)<1e-8);assert.ok(Math.abs(p[1]-lon)<1e-8);}});
test('service-worker local import returns a durable receipt result',async()=>{
  const listeners={},context={importScripts:()=>{},self:{addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn)},Trails:T};
  vm.runInNewContext(await readFile(new URL('../dist/sw.js',import.meta.url),'utf8'),context);
  const payload={version:1,trails:[{...trail,id:'link-import',rating:4.75}]};
  async function send(){let response;const waits=[];const e={data:{type:'IMPORT_LOCAL',payload,receiptId:'test-link-receipt'},ports:[{postMessage:r=>response=r}],waitUntil:p=>waits.push(p)};for(const fn of listeners.message)fn(e);await Promise.all(waits);return response;}
  assert.equal((await send()).count,1);assert.equal((await T.get('trails','link-import')).rating,4.75);assert.equal((await send()).count,0);
});
test('device pairing publishes only its public key and blocks silent replacement',async()=>{
  const config={repo:'test/repo',branch:'main',token:'local-test-token'};let putBody;
  globalThis.fetch=async(url,o)=>{if(o.method==='PUT'){putBody=JSON.parse(o.body);return Response.json({commit:{sha:'test'}});}return new Response('{}',{status:404});};
  assert.equal((await T.pairInbox(config)).paired,true);const published=JSON.parse(new TextDecoder().decode(T.un64(putBody.content)));assert.equal(published.type,'hiking-trails-public-key');assert.equal(published.publicKey.d,undefined);assert.ok(!JSON.stringify(putBody).includes(config.token));
  globalThis.fetch=async(url,o)=>{if(o.method==='PUT')throw Error('must not overwrite');return Response.json({sha:'other',content:T.b64(new TextEncoder().encode(JSON.stringify({publicKey:{n:'another-phone',e:'AQAB'}})))});};
  await assert.rejects(T.pairInbox(config),e=>e.code==='OTHER_DEVICE');
  globalThis.fetch=async()=>new Response('{}',{status:403});await assert.rejects(T.pairInbox(config),/GitHub 403/);
});

test('wishlist preserves unrated status, legacy reviews, backup and replay safety',async()=>{
  const wanted={id:'wishlist-test',name:'Test future trail',city:'Test city',description:'Want to go.',status:'want-to-go',rating:null};
  assert.equal(T.validate(wanted).rating,null);assert.equal(T.validate(wanted).difficulty,'');
  assert.equal(T.validate(trail).status,'visited');assert.equal(T.validate(trail).rating,4.75);
  assert.throws(()=>T.validate({...wanted,status:'visited'}));assert.throws(()=>T.validate({...wanted,status:'unknown'}));
  assert.equal(await T.ingest({version:2,trails:[wanted]},'wishlist-receipt'),1);
  const back=await T.backup('wishlist-password');await T.remove('trails',wanted.id);await T.restore(back,'wishlist-password');
  assert.equal((await T.get('trails',wanted.id)).rating,null);assert.equal((await T.get('trails',wanted.id)).status,'want-to-go');
  await T.write('trails',[T.validate({...wanted,status:'visited',rating:4.25,description:'User visited and edited.'})]);
  assert.equal(await T.ingest({version:2,trails:[wanted]},'wishlist-receipt'),0);
  assert.equal((await T.get('trails',wanted.id)).rating,4.25);
});
