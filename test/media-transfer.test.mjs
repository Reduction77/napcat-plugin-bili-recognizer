import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {DownloadManager,downloadError} from '../lib/downloads.mjs';
import {errorSummary} from '../lib/download-errors.mjs';
import {defaults} from '../lib/config.mjs';
const primary='https://primary.bilivideo.com/v?token=SECRET_URL',backup='https://backup.bilivideo.com/v?token=SECRET_URL';
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(4096,7)]);
async function fixture(t,fetcher){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bili-transfer-')),traces=[],calls=[],risks=[];
 const waits=[];
 const state={config:{...defaults},onTrace:r=>traces.push(r),gate:{async enter(){},hit:code=>risks.push(code)},client:{async resolve(l){return l;},async info(){return {title:'test',videoMeta:{bvid:'BV1uxYs6MEGH',pages:[{cid:1,duration:1}],rights:{}}};},async playInfo(){return {quality:32,durl:[{url:primary,backup_url:[backup]}]};}}};
 const manager=new DownloadManager(root,()=>state,()=>{},{wait:async(ms,signal)=>{signal.throwIfAborted();waits.push(ms);},fetcher:async(url,options)=>{calls.push(url);assert.equal(options.headers.Origin,'https://www.bilibili.com');assert.equal(options.headers.Referer,'https://www.bilibili.com/');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['Accept-Encoding'],'identity');return fetcher(url,options);}});
 await manager.init();t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});return {manager,root,traces,calls,risks,waits,state};
}
test('真实 Node fetch 在 200 后连接断开：捕获底层原因并切换备用地址完成文件',async t=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/primary'){res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':mp4.length});res.write(mp4.subarray(0,128));setTimeout(()=>res.destroy(),50);}
  else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':mp4.length});res.end(mp4);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 const f=await fixture(t,(url,opts)=>fetch(base+(url===primary?'/primary':'/backup'),opts));
 const queued=f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;
 const job=f.manager.list()[0];assert.equal(job.status,'done',job.error);assert.deepEqual(f.calls,[primary,backup]);assert.equal(job.bytes,mp4.length);
 assert.deepEqual(await fs.readFile(path.join(f.root,queued.id,'video.mp4')),mp4);
 const failure=f.traces.find(r=>r.downloadFailure)?.downloadFailure;
 assert.equal(failure.stage,'read_body');assert.equal(failure.name,'TypeError');assert.equal(failure.causeCode,'UND_ERR_SOCKET');assert.equal(failure.httpStatus,200);assert.equal(failure.receivedBytes,128);
 assert(f.traces.some(r=>r.phase==='COMPLETE'&&r.attempt===2));assert(!JSON.stringify(f.traces).includes('SECRET_URL'));
});
test('短响应体按 Content-Length 检查，备用重下不拼接残留字节',async t=>{
 const f=await fixture(t,url=>new Response(url===primary?mp4.subarray(0,99):mp4,{headers:{'Content-Length':mp4.length}}));
 f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;assert.equal(f.manager.list()[0].status,'done');assert.equal(f.manager.list()[0].bytes,mp4.length);assert(f.traces.some(r=>r.downloadFailure?.code==='MEDIA_TRUNCATED'));
});
test('仅重下失败音轨，已下载画面的字节计数保留',async t=>{
 const f=await fixture(t,url=>url===primary?Promise.reject(new TypeError('fetch failed',{cause:Object.assign(new Error('SECRET_CAUSE'),{code:'ECONNRESET'})})):new Response(mp4));
 const job={downloaded:777,stage:'下载音轨',bvid:'BV1uxYs6MEGH'},file=path.join(f.root,'track.bin');
 await f.manager.downloadStream({url:primary,urls:[primary,backup]},file,job,10000,new AbortController().signal);
 assert.equal(job.downloaded,777+mp4.length);assert.deepEqual(await fs.readFile(file),mp4);
});
test('412 和 429 不切换节点并触发冷却',async t=>{
 for(const status of [412,429]){const f=await fixture(t,()=>new Response(null,{status}));f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;assert.equal(f.calls.length,1);assert(f.risks.includes(status));assert.equal(f.manager.list()[0].status,'error');}
});
test('大小超限与文件错误不切换节点',async t=>{
 const f=await fixture(t,()=>new Response(mp4)),job={downloaded:0,stage:'下载视频'};
 await assert.rejects(f.manager.downloadStream({url:primary,urls:[primary,backup]},path.join(f.root,'limit.bin'),job,10,new AbortController().signal),{code:'LIMIT'});assert.equal(f.calls.length,1);
 f.calls.length=0;await assert.rejects(f.manager.downloadStream({url:primary,urls:[primary,backup]},path.join(f.root,'missing','file.bin'),{downloaded:0},10000,new AbortController().signal),{code:'ENOENT'});assert.equal(f.calls.length,1);
});
test('普通程序 TypeError 不当作网络错误重试，保留失败阶段',async t=>{
 const f=await fixture(t,()=>{throw new TypeError('PRIVATE_MESSAGE_WITH_SECRET_URL');});f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;
 assert.equal(f.calls.length,1);const job=f.manager.list()[0];assert.equal(job.failure.name,'TypeError');assert.equal(job.failure.stage,'connect');assert(!JSON.stringify(job).includes('PRIVATE_MESSAGE'));assert(!JSON.stringify(f.traces).includes('PRIVATE_MESSAGE'));
});
test('最多三个地址，每个至多尝试三次，取消任务不尝试备用地址',async t=>{
 const failure=()=>Promise.reject(new TypeError('terminated',{cause:Object.assign(new Error('socket closed'),{code:'UND_ERR_SOCKET'})}));
 const f=await fixture(t,failure),job={downloaded:0,stage:'下载视频'},urls=[primary,backup,'https://third.bilivideo.com/v','https://fourth.bilivideo.com/v'];
 await assert.rejects(f.manager.downloadStream({url:primary,urls},path.join(f.root,'file.bin'),job,10000,new AbortController().signal));assert.equal(f.calls.length,9);assert.deepEqual(f.calls,Array(3).fill(urls.slice(0,3)).flat());
 const abort=new AbortController();abort.abort();f.calls.length=0;
 await assert.rejects(f.manager.downloadStream({url:primary,urls},path.join(f.root,'cancel.bin'),job,10000,abort.signal));assert.equal(f.calls.length,0);
});
test('底层错误只导出固定类型、错误码与本地代码行，不导出消息或 socket 信息',()=>{
 const e=new TypeError('terminated',{cause:Object.assign(new Error('SECRET_COOKIE'),{code:'UND_ERR_SOCKET',socket:{remoteAddress:'PRIVATE_ADDRESS'}})});
 e.stack='TypeError: SECRET_URL\n at f (file:///private/downloads.mjs:123:4)';const d=errorSummary(e);
 assert.deepEqual(d.frames,['downloads.mjs:123:4']);assert.equal(d.causeCode,'UND_ERR_SOCKET');assert(!JSON.stringify(d).includes('SECRET'));e.downloadDiagnostic={...d,stage:'read_body',attempt:3};assert.match(downloadError(e),/读取视频数据失败.*UND_ERR_SOCKET/);
});

test('仅有一个 CDN 地址：两次真实 200 后断流仍可重试同地址成功，文件不混入残片',async t=>{
 let requests=0;
 const payload=Buffer.concat([mp4,Buffer.alloc(22*1048576,9)]);
 const server=http.createServer((req,res)=>{
  requests++;assert.equal(req.headers.origin,'https://www.bilibili.com');assert.equal(req.headers.referer,'https://www.bilibili.com/');assert.equal(req.headers.cookie,undefined);
  res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':payload.length});
  if(requests<=2){res.write(payload.subarray(0,21155758),()=>setTimeout(()=>res.destroy(),20));}else res.end(payload);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const f=await fixture(t,(url,opts)=>fetch('http://127.0.0.1:'+server.address().port,opts));
 f.state.client.playInfo=async()=>({quality:32,durl:[{url:primary}]});
 const result=f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;
 const j=f.manager.list()[0];assert.equal(j.status,'done',j.error);assert.equal(j.quality,32);assert.equal(j.bytes,payload.length);
 assert.deepEqual(f.calls,[primary,primary,primary]);assert.deepEqual(f.waits,[1000,2000]);
 assert.deepEqual(await fs.readFile(path.join(f.root,result.id,'video.mp4')),payload);
 const failures=f.traces.filter(r=>r.downloadFailure).map(r=>r.downloadFailure);
 assert.equal(failures.length,2);assert(failures.every(r=>r.causeCode==='UND_ERR_SOCKET'&&r.receivedBytes===21155758&&r.addressCount===1));
});
test('单地址持续失败最多三次，错误详情区分请求次数与地址数量',async t=>{
 const f=await fixture(t,()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('secret'),{code:'ECONNRESET'})});});
 f.state.client.playInfo=async()=>({quality:32,durl:[{url:primary}]});f.manager.enqueue('BV1uxYs6MEGH');await f.manager.worker;
 const j=f.manager.list()[0];assert.equal(f.calls.length,3);assert.equal(j.failure.attempt,3);assert.equal(j.failure.addressCount,1);assert.equal(j.failure.addressAttempt,3);assert.match(j.error,/已请求 3 次，共 1 个可用地址/);assert.equal(j.fileReady,false);
});
test('等待重试时取消立刻终止，不发起下一次请求，旧片段已清理',async t=>{
 const f=await fixture(t,()=>new Response(mp4.subarray(0,10),{headers:{'Content-Length':mp4.length}}));
 const abort=new AbortController(),file=path.join(f.root,'waiting.bin');let entered;const waiting=new Promise(r=>entered=r);
 f.manager.wait=async(ms,signal)=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const pending=f.manager.downloadStream({urls:[primary]},file,{downloaded:0,stage:'下载画面'},10000,abort.signal);
 await waiting;abort.abort();await assert.rejects(pending);assert.equal(f.calls.length,1);await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
test('403、404、空流不重试，已完成的音视频片段不计入失败重试流量',async t=>{
 for(const status of [403,404,200]){
  const f=await fixture(t,()=>new Response(null,{status}));const job={downloaded:999,stage:'下载音轨'};
  await assert.rejects(f.manager.downloadStream({urls:[primary]},path.join(f.root,'empty.bin'),job,10000,new AbortController().signal));assert.equal(f.calls.length,1);assert.equal(job.downloaded,999);
 }
});
