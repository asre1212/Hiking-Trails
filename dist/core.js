/* Shared by the page and service worker. No third-party scripts. */
globalThis.Trails = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = bytes => { let s=''; for(const b of new Uint8Array(bytes)) s+=String.fromCharCode(b); return btoa(s); };
  const un64 = s => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  let opening;
  function db() {
    return opening ||= new Promise((resolve,reject)=>{
      const r=indexedDB.open('hiking-trails',1);
      r.onupgradeneeded=()=>{ for(const n of ['trails','settings','receipts']) r.result.createObjectStore(n,{keyPath:'id'}); };
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    });
  }
  async function all(store) { const d=await db(); return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  async function get(store,id) { return (await all(store)).find(x=>x.id===id); }
  async function write(store,items) { const d=await db(); return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');for(const x of items)t.objectStore(store).put(x);t.oncomplete=res;t.onabort=()=>rej(t.error);t.onerror=()=>{};}); }
  async function remove(store,id) { const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(id);t.oncomplete=res;t.onabort=()=>rej(t.error);}); }
  function validate(x) {
    if(!x || typeof x!=='object') throw Error('Invalid trail.');
    const str=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
    const name=str(x.name,160),city=str(x.city,120),description=str(x.description,2000),rating=Number(x.rating);
    if(!name||!city||!description||!Number.isFinite(rating)||rating<0||rating>5||rating*2%1) throw Error('Every trail needs a name, city, description and rating from 0 to 5 in half-star steps.');
    const lat=x.lat==null||x.lat===''?null:Number(x.lat),lon=x.lon==null||x.lon===''?null:Number(x.lon);
    if((lat===null)!==(lon===null)||lat!==null&&(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85.0511||Math.abs(lon)>180)) throw Error('Provide both coordinates, within latitude ±85 and longitude ±180.');
    const id=str(x.id,120)||crypto.randomUUID();
    const distance=x.distance==null||x.distance===''?null:Number(x.distance);
    if(distance!==null&&(!Number.isFinite(distance)||distance<0||distance>10000))throw Error('Distance must be between 0 and 10,000 miles.');
    return {id,name,city,description,rating,lat,lon,address:str(x.address,300),difficulty:['Easy','Moderate','Hard'].includes(x.difficulty)?x.difficulty:'Moderate',distance,updatedAt:typeof x.updatedAt==='string'&&Number.isFinite(Date.parse(x.updatedAt))?x.updatedAt:new Date().toISOString()};
  }
  async function keys() {
    let k=await get('settings','keys');
    if(!k) { const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);k={id:'keys',publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)};await write('settings',[k]); }
    return k;
  }
  async function decryptDelivery(envelope) {
    if(envelope?.version!==1||envelope?.type!=='hiking-trails-delivery') throw Error('Unsupported encrypted delivery.');
    const k=await keys(),privateKey=await crypto.subtle.importKey('jwk',k.privateKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,un64(envelope.key));
    const aes=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(envelope.iv)},aes,un64(envelope.data));
    return JSON.parse(dec.decode(plain));
  }
  async function ingest(payload,receiptId) {
    if(payload?.version!==1||!Array.isArray(payload.trails)||!payload.trails.length||payload.trails.length>500) throw Error('Invalid delivery (1–500 trails required).');
    const trails=payload.trails.map(validate),d=await db();
    return new Promise((res,rej)=>{
      const t=d.transaction(['trails','receipts'],'readwrite'),receipts=t.objectStore('receipts'),r=receipts.get(receiptId);let count=0;
      r.onsuccess=()=>{ if(r.result)return;for(const trail of trails)t.objectStore('trails').put(trail);receipts.put({id:receiptId,at:new Date().toISOString()});count=trails.length; };
      t.oncomplete=()=>res(count);t.onabort=()=>rej(t.error);t.onerror=()=>{};
    });
  }
  async function passwordKey(password,salt,usages) {
    const k=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,usages);
  }
  async function backup(password) {
    if(password.length<8)throw Error('Use a backup password of at least 8 characters.');
    const payload={type:'hiking-trails-backup',version:1,createdAt:new Date().toISOString(),trails:await all('trails'),keys:await keys(),receipts:await all('receipts')};
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await passwordKey(password,salt,['encrypt']);
    return {type:'hiking-trails-encrypted-backup',version:1,salt:b64(salt),iv:b64(iv),data:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(payload))))};
  }
  async function restore(file,password) {
    if(file?.type!=='hiking-trails-encrypted-backup'||file.version!==1)throw Error('Select a Hiking Trails encrypted backup.');
    let p;try{const k=await passwordKey(password,un64(file.salt),['decrypt']);p=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(file.iv)},k,un64(file.data))));}catch{throw Error('Incorrect password or damaged backup.');}
    if(p.type!=='hiking-trails-backup'||p.version!==1||!Array.isArray(p.trails)||p.trails.length>50000||!Array.isArray(p.receipts)||!p.keys?.privateKey)throw Error('Invalid backup contents.');
    const records=p.trails.map(validate);
    await crypto.subtle.importKey('jwk',p.keys.privateKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    const d=await db();await new Promise((res,rej)=>{const t=d.transaction(['trails','settings','receipts'],'readwrite');for(const x of records)t.objectStore('trails').put(x);t.objectStore('settings').put({...p.keys,id:'keys'});for(const x of p.receipts)if(typeof x.id==='string')t.objectStore('receipts').put({id:x.id,at:x.at});t.oncomplete=res;t.onabort=()=>rej(t.error);t.onerror=()=>{};});return records.length;
  }
  let syncing;
  async function syncInbox() { return syncing ||= syncImpl().finally(()=>syncing=null); }
  async function syncImpl() {
    const c=await get('settings','github');if(!c?.token)return {message:'Set up GitHub delivery in Settings.',count:0};
    if(!/^[\w.-]+\/[\w.-]+$/.test(c.repo)||!c.branch||c.branch.length>100)throw Error('Invalid repository or branch.');
    const base=`https://api.github.com/repos/${c.repo}/contents/`,headers={Authorization:`Bearer ${c.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    const request=async(path,options={})=>{const r=await fetch(base+path,{cache:'no-store',...options,headers:{...headers,...options.headers}});if(!r.ok){const e=Error(`GitHub ${r.status}. Check repository access and Contents read/write permission.`);e.status=r.status;throw e;}return r.status===204?null:r.json();};
    let files;try{files=await request('inbox?ref='+encodeURIComponent(c.branch));}catch(e){if(e.status===404)return {message:'No inbox yet, or repository not accessible. Check Settings.',count:0};throw e;}
    if(!Array.isArray(files))throw Error('GitHub inbox must be a directory.');
    let count=0,removed=0;const errors=[];
    for(const f of files.filter(x=>x.type==='file'&&/^[a-zA-Z0-9_-]+\.json$/.test(x.name)).slice(0,100)) {
      try {
        const receiptId=`${c.repo}/${f.path}@${f.sha}`;
        if(!await get('receipts',receiptId)){
          const data=await request('inbox/'+encodeURIComponent(f.name)+'?ref='+encodeURIComponent(c.branch));
          if(data.sha!==f.sha)throw Error('Delivery changed during import; retry.');
          if(data.size>2000000||data.encoding!=='base64')throw Error('Delivery is too large or not encoded.');
          const envelope=JSON.parse(dec.decode(un64(data.content.replace(/\s/g,''))));
          count+=await ingest(await decryptDelivery(envelope),receiptId);
        }
        // A durable IndexedDB receipt exists before any remote deletion.
        await request('inbox/'+encodeURIComponent(f.name),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Remove received encrypted hiking delivery',sha:f.sha,branch:c.branch})});removed++;
      }catch(e){errors.push(`${f.name}: ${e.message}`);}
    }
    return {count,removed,errors,message:`${count} trail${count===1?'':'s'} received · ${removed} deliveries cleared${errors.length?' · '+errors.length+' need retry':''}.`};
  }
  return {db,all,get,write,remove,validate,keys,ingest,decryptDelivery,backup,restore,syncInbox,b64,un64};
})();
