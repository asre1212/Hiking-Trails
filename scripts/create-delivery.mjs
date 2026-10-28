#!/usr/bin/env node
// Usage: node scripts/create-delivery.mjs delivery-key.json trails.json inbox/UUID.json
// Only the output envelope belongs in GitHub. Never commit the plaintext input.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import '../dist/core.js';
const [keyPath,inputPath,outputPath]=process.argv.slice(2);
if(!keyPath||!inputPath||!outputPath){console.error('Usage: node scripts/create-delivery.mjs PUBLIC_KEY PLAINTEXT_INPUT ENCRYPTED_OUTPUT');process.exit(1);}
try{
  const keyFile=JSON.parse(await readFile(keyPath,'utf8'));
  if(keyFile.type!=='hiking-trails-public-key'||keyFile.version!==1||keyFile.publicKey?.d)throw Error('Use the public delivery key exported from the app.');
  const input=JSON.parse(await readFile(inputPath,'utf8'));
  if(input.version!==1||!Array.isArray(input.trails)||!input.trails.length||input.trails.length>500)throw Error('Input must be {version:1,trails:[...]} with 1–500 trails.');
  const trails=input.trails.map(Trails.validate);
  const payload={version:trails.some(t=>t.status==='want-to-go')?2:1,trails};
  const publicKey=await crypto.subtle.importKey('jwk',keyFile.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify(payload)));
  const key=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,await crypto.subtle.exportKey('raw',aes));
  const envelope={type:'hiking-trails-delivery',version:1,key:Trails.b64(key),iv:Trails.b64(iv),data:Trails.b64(data)};
  await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
  console.log('Encrypted delivery created. Commit only this output file to inbox/.');
}catch(e){console.error(e.message);process.exitCode=1;}
