import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {QrLogin,loginUrl} from '../lib/login.mjs';
import {RequestGate} from '../lib/net.mjs';
import {BiliClient} from '../lib/bili.mjs';
import {DownloadManager,mediaUrl,selectStreams} from '../lib/downloads.mjs';
import {defaults,normalize} from '../lib/config.mjs';
import {parseUrl} from '../lib/parser.mjs';
const exec=promisify(execFile),BV='BV1xx411c7mD';
const json=(data,headers={})=>new Response(JSON.stringify({code:0,data}),{headers});
const generated=()=>json({url:'https://passport.bilibili.com/h5-app/passport/login/scan?foo=abc',qrcode_key:'private-qr-key'});
function loginFixture(t,responder){
 const state={config:{cookie:'previous-cookie'}};const saved=[];let calls=0;
 const login=new QrLogin(()=>state,async(cookie,expected,valid)=>{assert(valid());assert.equal(expected,state.config.cookie);saved.push(cookie);state.config.cookie=cookie;},async(url,opts)=>{calls++;return url.includes('/generate')?generated():responder(url,opts);});
 t.after(()=>login.close());return {login,state,saved,calls:()=>calls};
}
test('扫码登录保存完整凭据，接口结果不暴露 Cookie 或二维码密钥',async t=>{
 const {login,saved}=loginFixture(t,()=>json({code:0},{'set-cookie':['SESSDATA=sample-session; Path=/','bili_jct=csrf-value; Path=/','DedeUserID=12345; Path=/']}));
 // Use real multi-value Headers, as provided by Node fetch.
 login.fetcher=async url=>{if(url.includes('/generate'))return generated();const h=new Headers();for(const x of ['SESSDATA=sample-session','bili_jct=csrf-value','DedeUserID=12345'])h.append('set-cookie',x+'; Domain=.bilibili.com; Path=/');return json({code:0},h);};
 const qr=await login.generate();assert.match(qr.image,/^data:image\/svg\+xml;base64,/);assert(!JSON.stringify(qr).includes('private-qr-key'));
 const result=await login.poll(qr.sessionId);assert.deepEqual(result,{state:'success',uid:'12345'});assert.equal(saved.length,1);assert.match(saved[0],/SESSDATA=sample-session/);assert(!JSON.stringify(login.status()).includes('sample-session'));
 await login.poll(qr.sessionId);assert.equal(saved.length,1);
});
test('新版跨域换票逐跳收集 Set-Cookie，且不发送旧账号 Cookie',async t=>{
 const urls=[];const {login,saved}=loginFixture(t,(url,opts)=>{
  urls.push(url);assert(!String(opts.headers.Cookie||'').includes('previous-cookie'));
  if(url.includes('/qrcode/poll'))return json({code:0,url:'https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=one'});
  if(url.includes('passport.bilibili.com')&&!url.includes('ticket=final'))return new Response(null,{status:302,headers:{'set-cookie':'SESSDATA=new-session; Domain=.bilibili.com; Path=/','location':'https://passport.biligame.com/crossDomain?ticket=two'}});
  if(url.includes('passport.biligame.com'))return new Response(null,{status:302,headers:{location:'https://passport.bilibili.com/crossDomain?ticket=final'}});
  const h=new Headers();h.append('set-cookie','bili_jct=new-csrf; Domain=.bilibili.com; Path=/');h.append('set-cookie','DedeUserID=54321; Domain=.bilibili.com; Path=/');return new Response('ok',{headers:h});
 });const qr=await login.generate();assert.equal((await login.poll(qr.sessionId)).state,'success');assert.equal(urls.length,4);assert.match(saved[0],/DedeUserID=54321/);
});
test('缺少凭据或跨域跳转到非 B站地址时保留旧登录',async t=>{
 for(const mode of ['incomplete','redirect']){
  const {login,state,saved}=loginFixture(t,url=>url.includes('/poll')?json({code:0,url:mode==='redirect'?'https://passport.bilibili.com/crossDomain?ticket=x':'https://www.bilibili.com/?DedeUserID=123'}):new Response(null,{status:302,headers:{location:'https://evil.example/crossDomain?ticket=x'}}));
  const qr=await login.generate();await assert.rejects(login.poll(qr.sessionId));assert.equal(saved.length,0);assert.equal(state.config.cookie,'previous-cookie');
 }assert.equal(loginUrl('https://evil.example/crossDomain?ticket=x',true),null);
});
test('二维码轮询限频、过期和取消后的结果不会覆盖账号',async t=>{
 const {login,calls}=loginFixture(t,()=>json({code:86101}));const qr=await login.generate();assert.equal((await login.poll(qr.sessionId)).state,'waiting');await login.poll(qr.sessionId);assert.equal(calls(),2);
 login.current.expiresAt=0;assert.equal((await login.poll(qr.sessionId)).state,'expired');assert.equal(calls(),2);login.cancel();await assert.rejects(login.poll(qr.sessionId),{code:'LOGIN_SESSION'});
 let release;const pending=new Promise(r=>release=r);login.lastGenerate=0;login.fetcher=()=>pending;const task=login.generate();login.cancel();release(generated());await assert.rejects(task,{code:'LOGIN_SESSION'});assert.equal(login.current,null);
});
test('412、429 和接口 -352 触发共享冷却，后续请求不访问网络',async()=>{
 for(const variant of [412,429,-352]){
  const gate=new RequestGate(()=>({...defaults,requestGapMs:0}));let calls=0;
  const client=new BiliClient(defaults,async()=>{calls++;return variant<0?new Response(JSON.stringify({code:variant})):new Response(null,{status:variant});},gate);
  await assert.rejects(client.api('/x/web-interface/nav'));assert(gate.until>Date.now()+290000);await assert.rejects(client.api('/x/web-interface/nav'),{code:'BACKOFF'});assert.equal(calls,1);client.close();
 }
});
test('下载域名、权限与编码限制；链接保留分 P 信息',()=>{
 assert.equal(mediaUrl('http://cdn.bilivideo.com/a'),'http://cdn.bilivideo.com/a');for(const url of ['https://bilivideo.com.evil.example/a','https://127.0.0.1/a','https://a:b@cdn.bilivideo.com/a'])assert.equal(mediaUrl(url),null);
 assert.throws(()=>selectStreams({is_preview:true},80),{code:'RESTRICTED'});
 assert.throws(()=>selectStreams({dash:{video:[{id:80,codecid:12}],audio:[{codecs:'mp4a.40.2'}]}},80),{code:'CODEC'});
 assert.equal(parseUrl(`https://www.bilibili.com/video/${BV}?p=2`).meta.page,2);
 assert.throws(()=>normalize({downloadMaxMB:400,downloadCacheMB:512}),/两倍/);
});
async function fixture(t,{plan,config={},fetcher,meta={}}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-download-'));const calls=[];
 const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(128)]);
 const state={config:{...defaults,...config},client:{async playInfo(bvid,cid,qn){return this.api('/x/player/wbi/playurl',{bvid,cid,qn});},async resolve(l){return l;},async info(){return {title:'测试视频',videoMeta:{bvid:BV,cid:10,duration:1,pages:[{cid:10,duration:1},{cid:20,duration:2,part:'第二集'}],rights:{},...meta}};},async api(p,q){calls.push({p,q});return plan||{quality:32,durl:[{url:'https://cdn.bilivideo.com/video',size:mp4.length}]};}}};
 const manager=new DownloadManager(dir,()=>state,()=>{},{fetcher:fetcher||(async(url,opts)=>{assert.equal(opts.headers.Cookie,undefined);return new Response(mp4);})});
 await manager.init();t.after(async()=>{await manager.close();await fs.rm(dir,{recursive:true,force:true});});return {manager,state,dir,calls,mp4};
}
test('按分 P 下载并保存，发送回调使用本地文件，重启恢复已完成记录',async t=>{
 const {manager,state,dir,calls,mp4}=await fixture(t);let sent;
 const queued=manager.enqueue(BV,{page:2,afterDownload:async file=>sent=file});await manager.worker;
 const job=manager.list()[0];assert.equal(job.status,'done');assert.equal(job.page,2);assert.equal(calls[0].q.cid,20);assert.match(sent,/^file:\/\//);const lease=await manager.file(queued.id);assert.deepEqual(await fs.readFile(lease.path),mp4);
 await assert.rejects(manager.clear(),{code:'QUEUE'});lease.release();await manager.close();
 const restored=new DownloadManager(dir,()=>state,()=>{});await restored.init();t.after(()=>restored.close());assert.equal(restored.list()[0].status,'done');assert(!JSON.stringify(restored.list()).includes('cdn.bilivideo.com'));
 await restored.clear();await assert.rejects(restored.file(queued.id));
});
test('大小和时长上限拒绝下载，失败时清除残留文件',async t=>{
 for(const options of [{meta:{pages:[{cid:10,duration:9999}]}},{plan:{durl:[{url:'https://cdn.bilivideo.com/a',size:200*1048576}]}},{config:{downloadMaxMB:0.00001}}]){
  const {manager,dir}=await fixture(t,options);manager.enqueue(BV);await manager.worker;assert.equal(manager.list()[0].status,'error');assert.match(manager.list()[0].error,/大小或时长/);assert.deepEqual(await fs.readdir(dir),[]);
 }
});
test('无 Content-Length 的大响应仍受实际字节限制',async t=>{
 const {manager,dir}=await fixture(t,{config:{downloadMaxMB:0.001},plan:{durl:[{url:'https://cdn.bilivideo.com/a'}]},fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2048));c.close();}}))});
 manager.enqueue(BV);await manager.worker;assert.equal(manager.list()[0].status,'error');assert.deepEqual(await fs.readdir(dir),[]);
});
test('下载重定向到未允许域名时不继续访问',async t=>{
 let count=0;const {manager}=await fixture(t,{fetcher:async()=>{count++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}});manager.enqueue(BV);await manager.worker;assert.equal(count,1);assert.match(manager.list()[0].error,/地址不受支持/);
});
test('取消下载会中止流、移除临时文件，且不触发 QQ 回调',async t=>{
 let started;const ready=new Promise(r=>started=r);let sends=0;
 const {manager,dir}=await fixture(t,{fetcher:async(url,{signal})=>{started();return new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}));}});
 const job=manager.enqueue(BV,{afterDownload:()=>sends++});await ready;manager.cancel(job.id);await manager.worker;assert.equal(manager.list()[0].status,'cancelled');assert.equal(sends,0);assert.deepEqual(await fs.readdir(dir),[]);
});
test('缺少 FFmpeg 时 DASH 在获取大文件之前失败',async t=>{
 let calls=0;const {manager}=await fixture(t,{config:{downloadQuality:80,ffmpegPath:'/missing-bili-ffmpeg'},plan:{dash:{video:[{id:80,codecid:7,baseUrl:'https://cdn.bilivideo.com/v'}],audio:[{codecs:'mp4a.40.2',baseUrl:'https://cdn.bilivideo.com/a'}]}},fetcher:async()=>{calls++;return new Response('x');}});
 manager.enqueue(BV);await manager.worker;assert.equal(calls,0);assert.match(manager.list()[0].error,/FFmpeg/);
});
test('实际 FFmpeg 将 480P H.264 画面与 AAC 音轨合并，输出高度为 480',async t=>{
 try{await exec('ffmpeg',['-version']);}catch{t.skip('服务器未安装 FFmpeg，跳过真实合并检查');return;}
 const {manager,dir}=await fixture(t,{config:{downloadQuality:32},plan:{quality:80,dash:{video:[{id:16,codecid:7,baseUrl:'https://cdn.bilivideo.com/low'},{id:32,codecid:7,baseUrl:'https://cdn.bilivideo.com/v'}],audio:[{codecs:'mp4a.40.2',baseUrl:'https://cdn.bilivideo.com/a'}]}}});
 const v=path.join(dir,'fixture-video.mp4'),a=path.join(dir,'fixture-audio.m4a');
 await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=854x480:r=10','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-an',v]);
 await exec('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','0.5','-c:a','aac','-vn',a]);
 manager.fetcher=async url=>new Response(await fs.readFile(url.endsWith('/v')?v:a));
 manager.enqueue(BV);await manager.worker;assert.equal(manager.list()[0].status,'done',manager.list()[0].error);
 const lease=await manager.file(manager.list()[0].id);const result=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-of','json',lease.path])).stdout);lease.release();
 assert.equal(manager.list()[0].quality,32);assert.equal(manager.list()[0].requestedQuality,32);assert.equal(result.streams[0].height,480);assert.deepEqual(result.streams.map(s=>s.codec_name),['h264','aac']);assert(result.streams.every(s=>Number(s.duration)>0));
});
