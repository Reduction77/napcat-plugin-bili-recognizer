import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionStore} from '../lib/cookies.mjs';
import {LiveMonitor} from '../lib/live.mjs';
import {registerWebUI} from '../lib/webui.mjs';
import {liveFixture} from './helpers/ui-harness.mjs';
async function sessionFixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-session-perf-'));const s=new SessionStore(dir,'SESSDATA=TEST');await s.init();t.after(async()=>{await s.flush().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});});return s;}
test('相同会话连续或并发保存只写一次，有变化立即按顺序写入',async t=>{
 const s=await sessionFixture(t),write=fs.writeFile;let writes=0;t.mock.method(fs,'writeFile',async(...args)=>{if(args[0]===s.file+'.tmp')writes++;return write(...args);});
 await Promise.all(Array.from({length:20},()=>s.save()));assert.equal(writes,1);for(let i=0;i<20;i++)await s.save();assert.equal(writes,1);
 s.jar.importLegacy('SESSDATA=NEW');const p1=s.save();s.jar.importLegacy('SESSDATA=LATEST');const p2=s.save();await Promise.all([p1,p2]);assert.equal(writes,3);assert.equal(JSON.parse(await fs.readFile(s.file,'utf8')).cookies.find(c=>c.name==='SESSDATA').value,'LATEST');
});
test('写盘失败后同一会话可重试，重启凭据保留',async t=>{
 const s=await sessionFixture(t),write=fs.writeFile;let once=true;t.mock.method(fs,'writeFile',async(...args)=>{if(args[0]===s.file+'.tmp'&&once){once=false;throw Object.assign(Error('write failed'),{code:'EIO'});}return write(...args);});
 await assert.rejects(s.save(),{code:'EIO'});await s.save();const restored=new SessionStore(path.dirname(s.file),'SESSDATA=TEST');await restored.init();assert.equal(restored.loaded,true);assert.match(restored.jar.header('https://api.bilibili.com/'),/SESSDATA=TEST/);
});
test('直播摘要省略内部缓存和正文，实际补发记录仍保留在后台',()=>{
 const m=new LiveMonitor('/unused',()=>({}),()=>{});m.data={...m.data,...liveFixture(),rooms:{'100':{title:'cached'}},manualNotices:{'100':{start:['111']}},manualTargets:['100']};const full=m.snapshot(),visible=m.snapshot(true);assert(!('rooms' in visible));assert(!('manualNotices' in visible));assert(!('manualTargets' in visible));assert(!('text' in visible.records[0]));assert.equal(visible.records[0].id,full.records[0].id);assert.equal(m.data.records[0].text,full.records[0].text);assert(Buffer.byteLength(JSON.stringify(visible))<Buffer.byteLength(JSON.stringify(full))/2);
});
test('概览只带四条记录，诊断摘要不带轨迹，完整列表与导出可读取',async()=>{
 const routes=new Map(),state={startedAt:Date.now(),config:{},stats:{},client:{cache:new Map()},records:Array.from({length:200},(_,i)=>({id:i})),traces:[{endpoint:'example'}],diagnostics:{report:{status:'done'}},gate:{snapshot:()=>({})}};registerWebUI({router:{static(){},page(){},get:(url,fn)=>routes.set(url,fn),post(){}}},()=>state,()=>{},()=>{});
 async function get(url){let result;await routes.get(url)({},{setHeader(){},json:d=>result=d,status(){return this;}});return result.data;}
 assert.equal((await get('/overview')).records.length,4);assert.equal((await get('/records')).records.length,200);assert(!('traces' in await get('/diagnostics/summary')));assert.equal((await get('/diagnostics')).traces.length,1);
});
