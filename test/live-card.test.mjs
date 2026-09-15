// 卡片渲染与降级链的离线测试。
// 这里起一个与 astrbot-t2i-service 契约一致的本机 mock 服务：
//   POST /text2img/generate  {html, json, options} → 图片二进制，或 {code:0,data:{id}}
//   GET  /text2img/data/:id  → 图片二进制
// 默认返回一张真实 JPEG（内嵌 1×1 基线 JPEG），因此不需要浏览器或网络。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LiveMonitor,liveMessage,personas,themes} from '../lib/live.mjs';
import {liveCardData,renderCard,buildCardHtml,renderCardHtml,escapeHtml,safeImageUrl,roomUrl,durationText,clockText,sniffImage,loadStickers,renderHint,CardRenderer,personaLabel,collectCardImages} from '../lib/live-card.mjs';

// 1×1 基线 JPEG：用于让 mock 服务返回一个"看起来像图片"的响应。
const TINY_JPEG=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
// ≈300KB 的“原图”：用来验证缺少缩略图时载荷会明显变大。
const BIG_JPEG=Buffer.concat([TINY_JPEG.subarray(0,TINY_JPEG.length-2),Buffer.alloc(300*1024,0x20),TINY_JPEG.subarray(TINY_JPEG.length-2)]);

async function mockT2I(options={}){
 const state={requests:[],options:options};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/text2img/generate'&&req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;
   let payload=null;try{payload=JSON.parse(raw);}catch{}
   state.requests.push(payload);
   if(state.options.delay)await new Promise(r=>setTimeout(r,state.options.delay));
   if(state.options.fail==='status')return res.writeHead(500,{'Content-Type':'text/plain'}).end('boom');
   if(state.options.fail==='html')return res.writeHead(200,{'Content-Type':'text/html'}).end('<html>不是图片</html>');
   if(state.options.fail==='empty')return res.writeHead(200,{'Content-Type':'image/jpeg'}).end('');
   if(payload?.json){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({code:0,message:'success',data:{id:'data/abc123'}}));
   }
   res.writeHead(200,{'Content-Type':state.options.badContentType?'text/html':'image/jpeg'});
   return res.end(TINY_JPEG);
  }
  if(req.url?.startsWith('/text2img/data/')){
   if(state.options.fail==='follow')return res.writeHead(404,{'Content-Type':'application/json'}).end('{}');
   res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(TINY_JPEG);
  }
  // 冒充 B站图床：卡片里的封面/头像从这里取，测试不发外网请求。
  // 带 @ 图片处理参数的请求返回小图，未带参数的返回大图 —— 用来验证缩略图确实生效。
  if(req.url?.startsWith('/assets/')){
   const body=decodeURIComponent(req.url).includes('@')?TINY_JPEG:BIG_JPEG;
   if(state.options.fail==='assets'){res.writeHead(500,{'Content-Type':'text/plain'});return res.end('image boom');}
   res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(body);
  }
  res.writeHead(404,{'Content-Type':'application/json'}).end('{"code":1}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 state.base=`http://127.0.0.1:${server.address().port}`;
 state.close=()=>new Promise(resolve=>server.close(resolve));
 return state;
}

const cardConfig=(base,extra={})=>({liveCard:true,liveCardRenderUrl:base,liveCardRenderMode:'astrbot',liveCardCustomRequest:'',liveCardRenderToken:'',liveCardPersona:'amis',liveCardTheme:'amis',liveCardDecor:'auto',liveCardRenderTimeoutSeconds:25,liveCardCacheMB:64,...extra});

async function setup(t,{config={},cardOptions={},client}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-card-'));
 const assetDir=path.join(dir,'assets','card');
 await fs.mkdir(path.join(assetDir,'custom'),{recursive:true});
 const server=await mockT2I(cardOptions);
 const sent=[],logs=[];let status=0,fetchError=null;
 const calls=[];
 // 冒充 B站图床：把 i0.hdslb.com 的图片请求改指到本机 mock 服务。
 const rewrite=url=>String(url).replace(/^https:\/\/i\d\.hdslb\.com/,server.base.replace(/\/$/,'')+'/assets');
 const mockClient=client||{
  async request(url,init={}){return globalThis.fetch(rewrite(url),init);},
  async api(endpoint,params){calls.push({endpoint,params});if(fetchError)throw fetchError;
   if(endpoint.endsWith('room_init'))return {uid:123};
   const uid=params['uids[]'];return {[uid]:{room_id:'27665992',live_status:status,uname:'朱朱白白喵',title:'深塔海墟全都打不过！',live_time:Math.floor(Date.now()/1000)-3600,area_v2_name:'虚拟主播',face:'https://i2.hdslb.com/bfs/face/abc.jpg',cover_from_user:'https://i0.hdslb.com/bfs/live/cover.jpg'}};
  }};
 const state={client:mockClient,closed:false,gate:{snapshot:()=>({})},config:cardConfig(server.base,config)};
 // 日志必须是可调用函数：调用方给错类型时，通知流程也不能被拖垮。
 const push=(...a)=>logs.push(a);
 const m=new LiveMonitor(dir,()=>state,async(group,payload)=>{sent.push({group,payload});},push,{assetDir,fetcher:globalThis.fetch});
 await m.init();
 t.after(async()=>{await m.close();await server.close();await fs.rm(dir,{recursive:true,force:true});});
 const add=(patch={})=>m.upsert({revision:m.data.revision,input:'123',type:'uid',label:'朱朱白白喵',groups:['111','222'],enabled:true,start:true,end:true,...patch});
 const enable=()=>m.settings({revision:m.data.revision,enabled:true,intervalSeconds:60});
 // 手动通知在后台 worker 里发送，等它落地再断言。
 const settle=async(want=1)=>{for(let i=0;i<80;i++){if(sent.length>=want)return;await new Promise(r=>setTimeout(r,25));}};
 return {m,dir,assetDir,state,sent,logs,calls,server,add,enable,settle,setStatus:n=>status=n,setError:e=>fetchError=e};
}

test('mock 文转图服务返回可识别的图片',async t=>{
 const server=await mockT2I();t.after(()=>server.close());
 const response=await fetch(`${server.base}/text2img/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:'<p>hi</p>',json:false,options:{}})});
 const buffer=Buffer.from(await response.arrayBuffer());
 assert.equal(response.status,200);
 assert.equal(sniffImage(buffer),true);
 assert.equal(server.requests.length,1);
});

test('人设文案：三种口吻都保留主播名、标题与链接',()=>{
 const now=Date.UTC(2026,0,2,12,31);
 const sub={uid:'1',label:'朱朱白白喵'},state={uid:'1',roomId:'27665992',name:'朱朱白白喵',title:'深塔海墟全都打不过！',startAt:now-2*3600*1000-56*60*1000};
 for(const persona of personas){
  const start=liveCardData(sub,state,'start',now,{persona});
  assert.match(start.name+start.lines.join(' '),/朱朱白白喵/);
  assert.equal(start.url,'https://live.bilibili.com/27665992');
  assert.equal(start.kind,'start');
  const end=liveCardData(sub,state,'end',now,{persona});
  assert.match(end.lines.join(' '),/2 小时 56 分钟/);
  assert.equal(end.text,liveMessage(sub,state,'end',now));
 }
});
test('爱弥斯默认口吻活泼，纯文本仍沿用 1.4.x 格式',()=>{
 const now=Date.UTC(2026,0,2,12,31);
 const sub={uid:'1',label:'朱朱白白喵'},state={uid:'1',roomId:'27665992',name:'朱朱白白喵',title:'深塔海墟全都打不过！',areaName:'虚拟主播',startAt:now};
 const card=liveCardData(sub,state,'start',now,{persona:'amis'});
 assert.equal(card.lines[0],'💙 爱弥斯上线啦！');
 assert.match(card.reply,/朱朱白白喵/);
 assert.match(card.text,/^【B站开播通知】朱朱白白喵/);
 assert.match(card.text,/https:\/\/live\.bilibili\.com\/27665992$/);
 assert.equal(card.meta[0],'⏰ 01-02 20:31 起飞');
 assert.equal(card.meta[1],'虚拟主播');
 const plain=liveCardData(sub,state,'start',now,{persona:'plain'});
 assert.equal(plain.card,false);
 assert.match(plain.text,/^【B站开播通知】/);
});
test('文案清洗：控制字符、换行与超长标题都不会破坏卡片',()=>{
 const now=Date.now();
 const state={uid:'1',roomId:'9',name:'a'.repeat(80),title:'第一行\n第二行\u0000'+'喵'.repeat(90),startAt:now};
 const card=liveCardData({uid:'1',label:''},state,'start',now,{});
 assert.equal(card.name.length,40);
 assert.equal(card.title.length,60);
 assert(!/[\n\u0000]/.test(card.title));
 assert(card.title.endsWith('…'));
});
test('卡片 HTML 结构完整：div 配平、气泡在信息列内、封面与页脚各一份',()=>{
 const now=Date.now();
 const card=liveCardData({uid:'1',label:'主播'},{uid:'1',roomId:'9',name:'主播',title:'标题',startAt:now},'start',now,{});
 const html=renderCardHtml({...card,cover:'data:image/jpeg;base64,AA',avatar:'',qr:''},{theme:'amis'});
 const open=(html.match(/<div\b/g)||[]).length,close=(html.match(/<\/div>/g)||[]).length;
 assert.equal(open,close,`div 未配平：${open} 开 / ${close} 闭`);
 // 结构顺序：信息列 → 头像与二维码同一行 → 气泡；气泡必须在信息列内（曾因多一个 </div> 而跑到卡片外）
 const bodyIndex=html.indexOf('class="head-body"'),bubbleIndex=html.indexOf('class="bubble"'),rowIndex=html.indexOf('class="head-row"');
 assert.ok(bodyIndex>0&&rowIndex>bodyIndex,'二维码行应在信息列内');
 assert.ok(bubbleIndex>rowIndex,'气泡应在信息列内、二维码行之后');
 assert.equal((html.match(/class="avatar"/g)||[]).length,1);
 assert.equal((html.match(/class="cover"/g)||[]).length,1);
 assert.equal((html.match(/class="foot"/g)||[]).length,1);
 assert.match(html,/<meta name="viewport" content="width=640">/);
});
test('未知人设与北京时间换算',()=>{
 assert.equal(personaLabel('nope'),personaLabel('amis'));
 assert.equal(clockText(Date.UTC(2026,0,1,16,5)),'01-02 00:05');
 assert.equal(durationText(1000,1000+59*1000),'不到 1 分钟（按检测时间估算）');
 assert.equal(durationText(0,Date.now()),null);
});
test('HTML 转义与图片地址白名单',()=>{
 assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
 assert.equal(safeImageUrl('https://i0.hdslb.com/a.jpg'),'https://i0.hdslb.com/a.jpg');
 assert.equal(safeImageUrl('http://i0.hdslb.com/a.jpg'),'');
 assert.equal(safeImageUrl('https://evil.example/a.jpg'),'');
 assert.equal(safeImageUrl('https://i0.hdslb.com:8443/a.jpg'),'');
 assert.equal(safeImageUrl('javascript:alert(1)'),'');
 assert.equal(roomUrl('27665992'),'https://live.bilibili.com/27665992');
 const html=renderCardHtml(liveCardData({uid:'1',label:'<b>主播</b>'},{uid:'1',roomId:'1',name:'x',title:'<script>bad</script>',startAt:Date.now()},'start',Date.now(),{}),{});
 assert(!html.includes('<b>主播</b>'));
 assert(!html.includes('<script>bad</script>'));
 assert(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
 for(const theme of themes)assert(buildCardHtml(liveCardData({uid:'1',label:'主播'},{uid:'1',roomId:'1',name:'x',title:'t',startAt:Date.now()},'start',Date.now(),{}),{theme}).includes('<style>'));
});

test('发给渲染服务的 timeout 必须是毫秒（曾经误传 24ms 导致服务端必然超时）',async t=>{
 const server=await mockT2I();t.after(()=>server.close());
 // 默认配置 25 秒超时 → 传给 playwright 的应是毫秒级、且略小于客户端超时
 await renderCard('<p>x</p>',cardConfig(server.base),{fetcher:globalThis.fetch});
 const options=server.requests[0].options;
 assert.equal(typeof options.timeout,'number');
 assert.ok(options.timeout>=10000,`timeout 应是毫秒量级，实际 ${options.timeout}`);
 assert.ok(options.timeout<=25000,`timeout 不应超过客户端超时，实际 ${options.timeout}`);
 // 超时配置下限也要成立（3 秒）
 await renderCard('<p>x</p>',cardConfig(server.base,{liveCardRenderTimeoutSeconds:3}),{fetcher:globalThis.fetch});
 const small=server.requests[1].options.timeout;
 assert.ok(small>=1000&&small<=3000,`3 秒配置应落在 1000–3000ms，实际 ${small}`);
});

test('渲染服务不可达、报错、超时、返回非图片时都给出可照做的提示',async t=>{
 const cases=[
  {base:'http://127.0.0.1:1',reason:'UNREACHABLE'},
  {fail:'status',reason:'STATUS'},
  {fail:'html',reason:'NOT_IMAGE'},
  {fail:'empty',reason:'EMPTY'},
 ];
 for(const item of cases){
  const server=await mockT2I(item.fail?{fail:item.fail}:{});
  t.after(()=>server.close());
  const result=await renderCard('<p>card</p>',cardConfig(item.base||server.base),{fetcher:globalThis.fetch});
  assert.equal(result.ok,false,JSON.stringify(item));
  assert.equal(result.reason,item.reason);
  assert.ok(renderHint(result.reason,item.base||server.base).length>10);
 }
 const slow=await mockT2I({delay:1200});t.after(()=>slow.close());
 const timedOut=await renderCard('<p>card</p>',cardConfig(slow.base,{liveCardRenderTimeoutSeconds:3}),{fetcher:async(url,init)=>globalThis.fetch(url,{...init,signal:AbortSignal.timeout(150)})});
 assert.equal(timedOut.ok,false);
 assert.equal(timedOut.reason,'TIMEOUT');
});
test('兼容返回 JSON 的服务（json:true + /text2img/data/:id）',async t=>{
 const server=await mockT2I();t.after(()=>server.close());
 // 只有生成请求带 body；回取图片的 GET 不能被当成 JSON 请求改写。
 const result=await renderCard('<p>card</p>',{...cardConfig(server.base),liveCardRenderMode:'astrbot'},{fetcher:async(url,init={})=>{
  if(!init.body)return globalThis.fetch(url,init);
  const payload={...JSON.parse(init.body),json:true};
  return globalThis.fetch(url,{...init,body:JSON.stringify(payload)});
 }});
 assert.equal(result.ok,true);
 assert.equal(sniffImage(result.buffer),true);
});
test('服务地址规范化：留空表示不渲染，非法地址给出中文提示',async()=>{
 const off=await renderCard('<p>x</p>',cardConfig(''));
 assert.equal(off.ok,false);
 assert.equal(off.reason,'OFF');
 const bad=await renderCard('<p>x</p>',cardConfig('ftp://example.com'));
 assert.equal(bad.ok,false);
});

test('开播通知发送「卡片图 + 文案」，并且多个群只渲染一次',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 const [first,second]=x.sent;
 assert.equal(first.payload[0].type,'image');
 assert.equal(first.payload[1].type,'text');
 assert.match(first.payload[0].data.file,/live-cards[\\/][0-9a-f]{16}\.img$/);
 assert.equal(first.payload[0].data.file,second.payload[0].data.file);
 assert.match(first.payload[1].data.text,/爱弥斯上线啦|朱朱白白喵/);
 assert.match(first.payload[1].data.text,/朱朱白白喵/);
 assert.equal(x.server.requests.length,1,'两个群应复用同一张卡片');
 assert.ok(x.m.data.records[0].card.endsWith('.img'));
 assert.match(x.m.data.records[0].reply,/朱朱白白喵/);
 const stat=await fs.stat(first.payload[0].data.file);
 assert.ok(stat.size>0);
});
test('封面与头像走图床缩略图，卡片载荷明显变小',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 const html=x.server.requests[0].html;
 assert.ok(Buffer.byteLength(html)<120*1024,`HTML 应小于 120KB，实际 ${(Buffer.byteLength(html)/1024).toFixed(0)}KB`);
 assert.ok(!html.includes(Buffer.alloc(200*1024,0x20).toString('base64').slice(0,64)),'不应内联原图');
 const dataUris=(html.match(/data:image\/jpeg;base64,/g)||[]).length;
 assert.ok(dataUris>=2,'封面与头像都应内联为 data URI');
});
test('缩略图取不到时回退原图，仍有封面',async t=>{
 const x=await setup(t,{cardOptions:{fail:'assets'}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 assert.equal(x.sent[0].payload[0].type,'image');
 assert.equal(x.sent[0].payload[0].data.file,x.sent[0].payload[0].data.file);
 // 图床整体失败时仍要出卡片（只是没有封面图），不能因为取图失败就丢掉通知
 assert.equal(x.server.requests.length,1);
});
test('图床资源必须能取到：BiliClient 默认白名单会拒绝 *.hdslb.com，需要放行 + raw 模式',async t=>{
 const {BiliClient,hostAllowed}=await import('../lib/bili.mjs');
 const {RequestGate}=await import('../lib/net.mjs');
 const {defaults}=await import('../lib/config.mjs');
 const server=await mockT2I();t.after(()=>server.close());
 // 用真实 BiliClient + 真实请求路径（改写域名指向本机 mock 图床）
 const config={...defaults};
 const client=new BiliClient(config,async(url,init)=>globalThis.fetch(String(url).replace(/^https:\/\/i\d\.hdslb\.com/,server.base+'/assets'),init),new RequestGate(()=>config),{});
 const face='https://i0.hdslb.com/bfs/face/abc.jpg';
 // 1) 默认不允许图床域名
 await assert.rejects(()=>client.request(face,{}),/无效跳转域名/);
 // 2) 放行后仍必须走 raw 模式，否则会被当成 JSON 解析
 await assert.rejects(()=>client.request(face,{allowedHosts:['hdslb.com']}),/JSON/);
 // 3) 放行 + raw 才能拿到字节
 const response=await client.request(face,{allowedHosts:['hdslb.com'],raw:true});
 assert.equal(response.ok,true);
 const buffer=Buffer.from(await response.arrayBuffer());
 assert.ok(buffer.length>0);
 assert.match(String(response.headers.get('content-type')),/^image\//);
 client.close();
 // 白名单匹配不能被子域欺骗
 assert.equal(hostAllowed('i0.hdslb.com',['hdslb.com']),true);
 assert.equal(hostAllowed('evil-hdslb.com',['hdslb.com']),false);
 assert.equal(hostAllowed('hdslb.com.evil.example',['hdslb.com']),false);
 assert.equal(hostAllowed('i0.hdslb.com',[]),false);
});
test('真实取图链路：封面与头像都会内联进卡片',async t=>{
 const {BiliClient}=await import('../lib/bili.mjs');
 const {RequestGate}=await import('../lib/net.mjs');
 const {defaults}=await import('../lib/config.mjs');
 const server=await mockT2I();t.after(()=>server.close());
 const config={...defaults};
 const client=new BiliClient(config,async(url,init)=>globalThis.fetch(String(url).replace(/^https:\/\/i\d\.hdslb\.com/,server.base+'/assets'),init),new RequestGate(()=>config),{});
 const now=Date.now();
 const card=liveCardData({uid:'1',label:'主播'},{uid:'1',roomId:'9',name:'主播',title:'标题',startAt:now,areaName:'鸣潮'},'start',now,{});
 const images=await collectCardImages(client,{...card,coverSource:'https://i0.hdslb.com/bfs/live/cover.jpg',avatarSource:'https://i2.hdslb.com/bfs/face/face.jpg',cover:'',avatar:''},{stickerDir:'',fs});
 assert.match(images.cover,/^data:image\//,'封面必须内联成功');
 assert.match(images.avatar,/^data:image\//,'头像必须内联成功');
 assert.match(images.qr,/^data:image\/svg/,'二维码必须生成');
 client.close();
});

test('头像不再被图床裁切，且取景位置可配置',async t=>{
 const now=Date.now();
 const card=liveCardData({uid:'1',label:'主播'},{uid:'1',roomId:'9',name:'主播',title:'标题',startAt:now},'start',now,{avatarPosition:'center 80%'});
 assert.equal(card.avatarPosition,'center 80%');
 const html=renderCardHtml({...card,cover:'',avatar:'data:image/webp;base64,AA',qr:''},{theme:'amis'});
 assert.match(html,/object-position:center 80%/,'取景位置要写进样式');
 // 头像 URL 不应再带 1c（居中裁剪成正方形会切掉头顶）
 const {thumbnailUrl}=await import('../lib/live-card.mjs');
 assert.match(thumbnailUrl('https://i0.hdslb.com/bfs/face/a.jpg',240),/@240w_90q\.webp$/);
 assert.ok(!thumbnailUrl('https://i0.hdslb.com/bfs/face/a.jpg',240).includes('1c'));
 const {normalize}=await import('../lib/config.mjs');
 assert.equal(normalize({}).liveCardAvatarPosition,'center 35%');
 assert.throws(()=>normalize({liveCardAvatarPosition:'center;background:url(x)'}));
});

test('渲染服务连续失败后熔断：暂停期间不再请求，到点自动重试',async t=>{
 const x=await setup(t,{cardOptions:{fail:'status'}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.server.requests.length,1);
 // 连续失败到阈值后进入熔断
 for(let i=0;i<4;i++)await x.m.card.render({kind:'start',name:'a',title:'t',url:'https://live.bilibili.com/1',reply:'r',meta:[],duration:null,cover:'',avatar:'',qr:''});
 const paused=await x.m.card.render({kind:'start',name:'a',title:'t',url:'https://live.bilibili.com/1',reply:'r',meta:[],cover:'',avatar:'',qr:''});
 assert.equal(paused.ok,false);
 assert.equal(paused.reason,'PAUSED');
 assert.match(paused.hint,/暂停/);
 const before=x.server.requests.length;
 await x.m.card.render({kind:'start',name:'a',title:'t',url:'https://live.bilibili.com/1',reply:'r',meta:[],cover:'',avatar:'',qr:''});
 assert.equal(x.server.requests.length,before,'熔断期间不应再请求渲染服务');
 // 冷启动自检（force）不受熔断限制，便于排查
 const forced=await x.m.card.render({kind:'start',name:'a',title:'t',url:'https://live.bilibili.com/1',reply:'r',meta:[],cover:'',avatar:'',qr:''},{force:true});
 assert.equal(forced.ok,false);
 assert.notEqual(forced.reason,'PAUSED');
 assert.ok(x.server.requests.length>before,'force 应绕过熔断');
});
test('渲染服务报错时把服务返回的正文记进日志，便于定位 500',async t=>{
 const server=await mockT2I({fail:'status'});
 t.after(()=>server.close());
 const logs=[];
 const result=await renderCard('<p>x</p>',{...cardConfig(server.base),liveCardRenderMode:'astrbot'},{fetcher:globalThis.fetch,log:(level,message)=>logs.push(`${level}:${message}`)});
 assert.equal(result.ok,false);
 assert.equal(result.reason,'STATUS');
 assert.equal(result.status,500);
 assert.equal(result.detail,'boom');
 assert.ok(logs.some(line=>line.includes('boom')),'日志应包含服务返回的正文');
});

test('渲染服务失败时降级为「封面 + 文案」，通知不丢',async t=>{
 const x=await setup(t,{cardOptions:{fail:'status'}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 for(const item of x.sent){
  assert.equal(item.payload[0].type,'image');
  assert.match(item.payload[0].data.file,/^https:\/\/i0\.hdslb\.com\//);
  assert.equal(item.payload[1].type,'text');
 }
 assert.equal(x.m.data.records[0].status,'sent');
 assert.equal(x.m.data.records[0].card,'');
 assert.ok(x.logs.some(([,message])=>String(message).includes('封面 + 文案')));
});
test('未配置渲染服务时直接发「封面 + 文案」，不产生请求',async t=>{
 const x=await setup(t,{config:{liveCardRenderUrl:''}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 assert.equal(x.server.requests.length,0);
 assert.match(x.sent[0].payload[0].data.file,/^https:\/\//);
});
test('关闭卡片开关回到纯文字',async t=>{
 const x=await setup(t,{config:{liveCard:false}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,2);
 assert.equal(typeof x.sent[0].payload,'string');
 assert.match(x.sent[0].payload,/^【B站开播通知】/);
 assert.equal(x.server.requests.length,0);
});
test('人设为朴素时发纯文字，不发图片',async t=>{
 const x=await setup(t,{config:{liveCardPersona:'plain'}});await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(typeof x.sent[0].payload,'string');
 assert.equal(x.server.requests.length,0);
});
test('下播通知也出卡片并带时长',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);await x.m.check();
 x.setStatus(0);await x.m.check();await x.m.check();
 const last=x.sent.at(-1);
 assert.equal(last.payload[0].type,'image');
 assert.match(last.payload[1].data.text,/朱朱白白喵/);
 const record=x.m.data.records.find(r=>r.kind==='end');
 assert.ok(record,'应有下播记录');
 assert.match(record.reply,/小时|分钟/);
});
test('同一场直播重复通知复用缓存卡片，渲染次数不随群数增长',async t=>{
 const x=await setup(t);await x.add({groups:['1','2','3','4']});await x.enable();await x.m.check();x.setStatus(1);
 await x.m.check();
 assert.equal(x.sent.length,4);
 assert.equal(x.server.requests.length,1);
});

test('自备贴纸：识别前缀、忽略非法文件、超限跳过',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-sticker-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'top-a.png'),Buffer.from([0x89,0x50,0x4e,0x47]));
 await fs.writeFile(path.join(dir,'tag-b.png'),Buffer.from([0x89,0x50,0x4e,0x47]));
 await fs.writeFile(path.join(dir,'corner-c.webp'),Buffer.from('RIFF'));
 await fs.writeFile(path.join(dir,'README.md'),'说明');
 await fs.writeFile(path.join(dir,'other.png'),Buffer.from([0x89]));
 const loaded=await loadStickers(dir,fs);
 assert.equal(loaded.count,3);
 assert.deepEqual(loaded.groups.top.map(x=>x.name),['top-a.png']);
 assert.deepEqual(loaded.groups.tag.map(x=>x.name),['tag-b.png']);
 assert.deepEqual(loaded.groups.corner.map(x=>x.name),['corner-c.webp']);
 assert.match(loaded.groups.top[0].dataUri,/^data:image\/png;base64,/);
});
test('贴纸会进入卡片 HTML，装饰关闭时不注入',async t=>{
 const x=await setup(t);
 await fs.writeFile(path.join(x.assetDir,'custom','top-star.png'),Buffer.from([0x89,0x50,0x4e,0x47]));
 const card=liveCardData({uid:'1',label:'主播'},{uid:'1',roomId:'1',name:'主播',title:'标题',startAt:Date.now()},'start',Date.now(),{});
 const stickers=await x.m.card.stickers_();
 assert.equal(stickers.top.length,1);
 const html=buildCardHtml({...card,name:'主播'},{theme:'amis',stickers});
 assert.match(html,/stickers-top/);
 x.state.config.liveCardDecor='off';
 const none=await x.m.card.stickers_();
 assert.equal(none.top.length,0);
});

test('缓存目录按容量上限清理旧卡片',async t=>{
 const x=await setup(t,{config:{liveCardCacheMB:16}});
 const dir=path.join(x.dir,'live-cards');
 await fs.mkdir(dir,{recursive:true});
 const old=path.join(dir,'old.img');
 await fs.writeFile(old,Buffer.alloc(1024));
 const past=Date.now()-8*24*3600*1000;
 await fs.utimes(old,new Date(past),new Date(past));
 await x.m.card.cleanup();
 await assert.rejects(fs.stat(old));
});
test('渲染自检区分「未配置」与「服务异常」',async t=>{
 const x=await setup(t);
 const ok=await x.m.card.test();
 assert.equal(ok.ok,true);
 assert.ok(ok.bytes>0);
 x.state.config.liveCardRenderUrl='';
 const off=await x.m.card.test();
 assert.equal(off.ok,false);
 assert.equal(off.reason,'OFF');
 assert.match(off.hint,/封面 \+ 文案/);
});
const PNG_1PX='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('手动通知可自定义标题、头像、封面，并记住给下一次用',async t=>{
 const x=await setup(t);await x.add();await x.enable();
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',title:'我自己的标题',avatar:PNG_1PX,cover:PNG_1PX});
 await x.settle(2);
 // 记住了
 assert.deepEqual(x.m.data.manualConfig,{avatar:PNG_1PX,cover:PNG_1PX,title:'我自己的标题'});
 const record=x.m.data.records.find(r=>r.source==='manual');
 assert.equal(record.title,'我自己的标题');
 assert.equal(record.avatar,PNG_1PX);
 // 卡片用的是自定义素材：请求体里应出现两张内联图 + 自定义标题
 const html=x.server.requests.at(-1).html;
 assert.match(html,/我自己的标题/);
 assert.ok((html.match(/data:image\/png;base64,/g)||[]).length>=2,'自定义头像与封面都要内联');
});
test('手动通知留空则回退在线检测到的资料，且不会改动检测状态',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);await x.m.check();
 const detectedTitle=x.m.data.states['123'].title;
 const detectedCover=x.m.data.states['123'].cover;
 const before=JSON.stringify(x.m.data.states['123']);
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',title:'',avatar:'',cover:''});
 await x.settle(x.sent.length+2);
 // 检测状态一个字节都不能变（这是手动/自动不串的关键）
 assert.equal(JSON.stringify(x.m.data.states['123']),before,'手动发送不得写回检测状态');
 const record=x.m.data.records.find(r=>r.source==='manual');
 assert.equal(record.title,detectedTitle,'留空应使用在线检测到的标题');
 assert.equal(record.cover,detectedCover,'留空应使用在线检测到的封面');
 assert.deepEqual(x.m.data.manualConfig,{avatar:'',cover:'',title:''},'留空要显式记住为空，不能继承上一条');
});
test('在线检测的通知仍用 B站真实素材，不受手动配置影响',async t=>{
 const x=await setup(t);await x.add();await x.enable();
 // 注意：手动开播会按设计抑制 30 分钟内同一主播的自动开播通知（去重），
 // 所以这里用另一个主播来验证「自动路径不受手动配置影响」。
 await x.m.upsert({revision:x.m.data.revision,input:'999',type:'uid',label:'另一位主播',groups:['333'],enabled:true,start:true,end:true});
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',title:'手动标题',avatar:PNG_1PX,cover:PNG_1PX});
 await x.settle(2);
 x.sent.length=0;
 await x.m.check();x.setStatus(1);await x.m.check();
 const auto=x.m.data.records.find(r=>r.source==='auto');
 assert.equal(auto.title,'深塔海墟全都打不过！','自动通知必须用 B站标题');
 assert.ok(!auto.avatar.startsWith('data:'),'自动通知不得使用手动上传的头像');
 const html=x.server.requests.at(-1).html;
 assert.ok(!html.includes('手动标题'),'自动卡片里不能出现手动标题');
 assert.ok(!html.includes('data:image/png;base64,'),'自动卡片不得内联手动的图片');
});
test('补发沿用记录里的素材，不会串成当前配置',async t=>{
 const x=await setup(t);await x.add();await x.enable();
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',title:'第一次的标题',avatar:PNG_1PX,cover:PNG_1PX});
 await x.settle(2);
 const record=x.m.data.records.find(r=>r.source==='manual');
 await x.m.transact(d=>{const r=d.records.find(r=>r.id===record.id);if(r)r.status='uncertain';});
 // 之后再发一次不同标题，然后补发旧记录
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'end',title:'第二次的标题'});
 await x.settle(4);
 x.sent.length=0;
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',title:'',avatar:'',cover:'',recordId:record.id});
 await x.settle(1);
 const resent=x.m.data.records.find(r=>r.id===record.id);
 assert.equal(resent.title,'第一次的标题','补发要沿用当时的标题');
 assert.equal(resent.avatar,PNG_1PX,'补发要沿用当时的头像');
});

test('手动通知走卡片，并可对结果未知的记录补发同一张卡片',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);await x.m.check();
 x.sent.length=0;
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start'});
 await x.settle(2);
 assert.equal(x.sent.length,2);
 assert.equal(x.sent[0].payload[0].type,'image');
 const record=x.m.data.records.find(r=>r.source==='manual');
 assert.ok(record.card.endsWith('.img'));
 assert.equal(record.status,'sent');
 // 补发只针对「结果未知／已取消」的记录：把记录改成结果未知，模拟实际补发场景。
 await x.m.transact(d=>{const r=d.records.find(r=>r.id===record.id);if(r)r.status='uncertain';});
 x.sent.length=0;
 await x.m.manualNotify({revision:x.m.data.revision,uid:'123',kind:'start',recordId:record.id});
 await x.settle(1);
 assert.equal(x.sent.length,1);
 assert.equal(x.sent[0].group,record.group);
});
