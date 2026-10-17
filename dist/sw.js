importScripts('./core.js');
const CACHE='hiking-trails-v1';
const SHELL=['./','./index.html','./style.css','./app.js','./core.js','./map.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('hiking-trails-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.includes('/api/'))return;
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).catch(()=>e.request.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
async function sync(){const result=await Trails.syncInbox();for(const c of await clients.matchAll())c.postMessage({type:'SYNC_RESULT',result});return result;}
self.addEventListener('sync',e=>{if(e.tag==='hiking-inbox')e.waitUntil(sync().then(r=>{if(r.errors?.length)throw Error('Delivery pending retry');}));});
self.addEventListener('message',e=>{if(e.data?.type==='SYNC_INBOX')e.waitUntil(sync().then(result=>e.ports[0]?.postMessage({result})).catch(error=>e.ports[0]?.postMessage({error:error.message})));});
