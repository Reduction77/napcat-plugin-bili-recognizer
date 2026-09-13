import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mediaUrl,inspectMediaUrl} from '../lib/media-url.mjs';
import {DownloadManager,selectStreams} from '../lib/downloads.mjs';
import {defaults} from '../lib/config.mjs';
import {traceLine} from '../lib/trace.mjs';
const BV='BV1uxYs6MEGH',node='http://fixture.mcdn.bilivideo.cn:4483/video?sig=SIGNED_SECRET&x=%2f';
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(100)]);
test('带端口的已允许 CDN 地址保留协议、端口与签名原文',()=>{
 for(const url of [node,node.replace('http:','https:'),'https://fixture.bilivideo.com:8443/video?sig=SIGNED_SECRET'])assert.equal(mediaUrl(url),url);
 assert.equal(mediaUrl('//fixture.bilivideo.com/v'),'https://fixture.bilivideo.com/v');
 for(const url of ['http://127.0.0.1:4483/video','https://fixture.bilivideo.com.evil.example:4483/video','http://user:pass@fixture.bilivideo.com:4483/v','file:///video','http://fixture.bilivideo.com:99999/v','http://fixture.bilivideo.com/\nSECRET'])assert.equal(mediaUrl(url),null);
});
test('从同一条流的备用地址中优先选 HTTPS 默认端口节点',()=>{
 const p=selectStreams({durl:[{url:node,size:100,backup_url:['https://cdn.bilivideo.com/v?sig=BACKUP_SECRET']}]},32);
 assert.equal(p.streams[0].url,'https://cdn.bilivideo.com/v?sig=BACKUP_SECRET');assert.equal(p.streams[0].size,100);
});
test('DASH 兼容 url、base_url、baseUrl、backup_url、backupUrl，不混合不同轨道',()=>{
 const p=selectStreams({dash:{video:[{id:80,codecid:7,url:'https://cdn.bilivideo.com/video'}],audio:[{codecs:'mp4a.40.2',baseUrl:'https://unsupported.example/audio',backupUrl:['https://cdn.bilivideo.com/audio']}]}},80);
 assert.deepEqual(p.streams.map(x=>x.url),['https://cdn.bilivideo.com/video','https://cdn.bilivideo.com/audio']);
 assert.equal(selectStreams({durl:[{base_url:'https://cdn.bilivideo.com/v'}]},32).streams[0].url,'https://cdn.bilivideo.com/v');
});
test('候选地址全部被拒绝时诊断只包含域名端口协议原因',()=>{
 assert.throws(()=>selectStreams({durl:[{url:'https://unknown.example:4483/private-path?token=SIGNED_SECRET'}]},32),e=>{
  assert.equal(e.code,'MEDIA_URL');assert.deepEqual(e.mediaCandidates,[{host:'unknown.example',port:'4483',protocol:'https:',reason:'HOST_NOT_ALLOWED'}]);assert(!JSON.stringify(e).includes('SIGNED_SECRET'));assert(!JSON.stringify(e).includes('private-path'));return true;
 });assert.equal(inspectMediaUrl(undefined).reason,'MISSING_URL');
});
async function fixture(t,stream,fetcher){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bili-media-')),calls=[],traces=[];
 const state={config:{...defaults,cookie:'ACCOUNT_SECRET'},onTrace:r=>traces.push(r),client:{async resolve(l){return l;},async info(){return {title:'video',videoMeta:{bvid:BV,pages:[{cid:41703771339,duration:1}],rights:{}}};},async playInfo(){return {quality:32,durl:[stream]};}}};
 const manager=new DownloadManager(root,()=>state,()=>{},{fetcher:async(url,opts)=>{calls.push(url);assert.equal(opts.headers.Cookie,undefined);assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.redirect,'manual');return fetcher?fetcher(url):new Response(mp4);}});
 await manager.init();t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});return {manager,calls,traces};
}
test('自定义端口视频实际进入下载并保存为本地文件，不发送账号 Cookie',async t=>{
 const f=await fixture(t,{url:node,size:mp4.length});let sent;const job=f.manager.enqueue(BV,{afterDownload:file=>{sent=file;}});await f.manager.worker;
 assert.equal(f.manager.list()[0].status,'done');assert.deepEqual(f.calls,[node]);assert.match(sent,/^file:\/\//);
 const lease=await f.manager.file(job.id);assert.deepEqual(await fs.readFile(lease.path),mp4);lease.release();
 assert(!JSON.stringify(f.traces).includes('SIGNED_SECRET'));assert(!f.traces.map(traceLine).join('\n').includes('SIGNED_SECRET'));
});
test('主地址不受支持时使用有效备用地址完成下载，不访问主地址',async t=>{
 const f=await fixture(t,{url:'https://unsupported.example/v',backup_url:['https://cdn.bilivideo.com/v']});f.manager.enqueue(BV);await f.manager.worker;
 assert.equal(f.manager.list()[0].status,'done');assert.deepEqual(f.calls,['https://cdn.bilivideo.com/v']);
});
test('媒体重定向支持 CDN 非默认端口，未知域名拒绝且诊断脱敏',async t=>{
 for(const allowed of [true,false]){
  const target=allowed?node:'https://unknown.example:4483/private-path?sig=SIGNED_SECRET';
  const f=await fixture(t,{url:'https://cdn.bilivideo.com/start'},url=>url.endsWith('/start')?new Response(null,{status:302,headers:{location:target}}):new Response(mp4));
  f.manager.enqueue(BV);await f.manager.worker;assert.equal(f.manager.list()[0].status,allowed?'done':'error');assert.equal(f.calls.length,allowed?2:1);
  if(!allowed){assert(f.traces.some(r=>r.mediaCandidates?.[0].reason==='HOST_NOT_ALLOWED'));assert(!JSON.stringify(f.traces).includes('SIGNED_SECRET'));}
 }
});
