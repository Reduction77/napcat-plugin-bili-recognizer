// Local synthetic comparison; never contacts Bilibili or QQ.
// Usage: node scripts/benchmark-performance.mjs /path/to/extracted/1.4.1
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {uiHarness,liveFixture} from '../test/helpers/ui-harness.mjs';
const current=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=process.argv[2]&&path.resolve(process.argv[2]);
async function measure(root){
 const source=await fs.readFile(path.join(root,'webui/app.js'),'utf8');const x=await uiHarness(source);x.context.data=liveFixture();x.eval("page='live';renderLive(data)");x.writes.clear();
 for(let i=0;i<20;i++)x.eval('renderLiveRows(data)');
 const unchangedListReplacements=(x.writes.get('#live-subscriptions')||0)+(x.writes.get('#live-records')||0);
 for(let i=0;i<12;i++)await x.tick(5000);
 const idleRequestsPerMinute=x.requests.length;
 const {SessionStore}=await import(pathToFileURL(path.join(root,'lib/cookies.mjs')));const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-perf-'));
 const session=new SessionStore(dir,'SESSDATA=SYNTHETIC_TEST');let sessionWrites=0;const originalWrite=fs.writeFile;
 try{await session.init();fs.writeFile=async(...args)=>{if(args[0]===session.file+'.tmp')sessionWrites++;return originalWrite(...args);};await Promise.all(Array.from({length:20},()=>session.save()));await session.flush();}
 finally{fs.writeFile=originalWrite;await fs.rm(dir,{recursive:true,force:true});}
 const {LiveMonitor}=await import(pathToFileURL(path.join(root,'lib/live.mjs')));const m=new LiveMonitor('/unused',()=>({}),()=>{});m.data={...m.data,...liveFixture()};
 const livePayloadBytes=Buffer.byteLength(JSON.stringify(m.snapshot(true)));const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 return {version:pkg.version,idleRequestsPerMinute,unchangedListReplacementsFor20Renders:unchangedListReplacements,sessionWritesFor20IdenticalSaves:sessionWrites,livePayloadBytes};
}
console.log(JSON.stringify({method:'Node VM simulated DOM / clock; 20 subscriptions and 100 synthetic notification records, each with a 400-character stored message. Payload excludes response envelope and risk. No real browser layout or remote API measurement.',...(baseline?{before:await measure(baseline)}:{}),after:await measure(current)},null,2));
