import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as plugin from '../index.mjs';
import {EventEmitter} from 'node:events';
import {defaults} from '../lib/config.mjs';
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-web-'));const routes=new Map();const pages=[];const sent=[];
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{bvid:'BV1xx411c7mD',title:'测试视频',owner:{name:'UP'},stat:{view:10}}}));
 const ctx={configPath:path.join(dir,'config.json'),pluginPath:dir,logger:{info(){},warn(){}},adapterName:'test',pluginManager:{config:{}},router:{static(){},page(x){pages.push(x);},get(p,h){routes.set('GET '+p,h);},post(p,h){routes.set('POST '+p,h);}},actions:{async call(name,...args){if(name==='get_group_list')return [{group_id:123,group_name:'测试群',member_count:5}];sent.push([name,...args]);return {message_id:1};}}};
 await fs.writeFile(ctx.configPath,JSON.stringify({...defaults,cookie:'secret-session'}));await plugin.plugin_init(ctx);
 t.after(async()=>{await plugin.plugin_cleanup(ctx);globalThis.fetch=realFetch;await fs.rm(dir,{recursive:true,force:true});});
 async function call(method,url,body){let code=200,data;await routes.get(method+' '+url)({body},{status(x){code=x;return this;},json(x){data=x;return this;}});return {code,...data};}
 return {ctx,call,pages,sent,routes};
}
test('注册专属页面，所有业务接口走 NapCat 鉴权路由',async t=>{const {call,pages}=await setup(t);assert.equal(pages[0].path,'dashboard');const s=await call('GET','/status');assert.equal(s.data.version,'1.5.5');assert(!JSON.stringify(s).includes('secret-session'));});
test('配置接口不返回 Cookie，普通保存保留 Cookie，支持明确清除',async t=>{const {ctx,call}=await setup(t);let c=(await call('GET','/config')).data;assert(c.cookieConfigured);assert(!('cookie' in c.config));let r=await call('POST','/config',{revision:c.revision,config:{showCover:false},cookieAction:'keep'});assert.equal(r.code,0);assert.equal((await plugin.plugin_get_config(ctx)).cookie,'secret-session');c=r.data;r=await call('POST','/config',{revision:c.revision,config:{},cookieAction:'clear'});assert.equal(r.data.cookieConfigured,false);});
test('配置冲突与校验失败不覆盖旧设置',async t=>{const {ctx,call}=await setup(t);await call('POST','/config',{revision:0,config:{enabled:false}});const r=await call('POST','/config',{revision:0,config:{enabled:true}});assert.equal(r.code,-1);assert.equal((await plugin.plugin_get_config(ctx)).enabled,false);const invalid=await call('POST','/config',{revision:1,config:{groupIds:'invalid'}});assert.equal(invalid.code,-1);});
test('并发群开关合并保存，群列表适配实际 OneBot 返回',async t=>{const {ctx,call}=await setup(t);await Promise.all([call('POST','/groups/toggle',{id:'123',enabled:false}),call('POST','/groups/toggle',{id:'456',enabled:false})]);const c=await plugin.plugin_get_config(ctx);assert.equal(c.groupMode,'deny');assert.equal(c.groupIds,'123\n456');const g=(await call('GET','/groups')).data;assert.equal(g.groups[0].enabled,false);await call('POST','/groups/toggle',{id:'123',enabled:true});assert.equal((await plugin.plugin_get_config(ctx)).groupIds,'456');});
test('页面预览不发送 QQ，更新记录、统计和缓存',async t=>{const {call,sent}=await setup(t);const r=await call('POST','/preview',{input:'BV1xx411c7mD'});assert.equal(r.data.results[0].title,'测试视频');assert.equal(sent.length,0);assert.equal((await call('GET','/records')).data.records.length,1);assert.equal((await call('GET','/status')).data.stats.tests,1);assert.equal((await call('GET','/cache')).data.items.length,1);await call('POST','/cache/clear');assert.equal((await call('GET','/cache')).data.items.length,0);});
test('不合法预览和配置请求有明确错误，日志不暴露 Cookie',async t=>{const {call}=await setup(t);assert.equal((await call('POST','/preview',{input:'hello'})).code,-1);assert.equal((await call('POST','/preview',{input:'x'.repeat(2001)})).code,-1);assert.equal((await call('POST','/config',{revision:0,config:{},cookieAction:'replace'})).code,-1);assert(!JSON.stringify((await call('GET','/logs'))).includes('secret-session'));});
test('WebUI 扫码成功保存到配置，状态与配置接口不回传凭据',async t=>{
 const {ctx,call}=await setup(t);
 globalThis.fetch=async url=>{
  if(url.includes('/generate'))return new Response(JSON.stringify({code:0,data:{qrcode_key:'hidden-key',url:'https://qr-fixture.example/login?key=abc'}}));
  if(url.includes('/poll'))return new Response(JSON.stringify({code:0,data:{code:0,url:'http://passport.bilibili.com/crossDomain?ticket=hidden-ticket'}}));
  const h=new Headers({Location:'http://landing-fixture.example/'});for(const c of ['SESSDATA=new-secret','bili_jct=csrf','DedeUserID=123'])h.append('Set-Cookie',c+'; Domain=.bilibili.com; Path=/; Secure');return new Response(null,{status:302,headers:h});
 };
 await plugin.plugin_init(ctx);
 const q=await call('POST','/account/qr',{});assert.equal(q.code,0);assert(!JSON.stringify(q).includes('hidden-key'));
 const result=await call('POST','/account/poll',{sessionId:q.data.sessionId});assert.equal(result.data.state,'success');assert.match((await plugin.plugin_get_config(ctx)).cookie,/SESSDATA=new-secret/);
 for(const url of ['/account','/status','/config','/logs'])assert(!JSON.stringify(await call('GET',url)).includes('new-secret'));
 assert.match((await fs.readFile(ctx.configPath,'utf8')),/SESSDATA=new-secret/);
 await call('POST','/account/remove',{});assert.equal((await plugin.plugin_get_config(ctx)).cookie,'');
});
test('QQ 下载指令去重并按分 P 发送本地视频，WebUI 文件接口受鉴权路由保护',async t=>{
 const {ctx,call,sent,routes}=await setup(t);const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/nav'))return new Response(JSON.stringify({code:0,data:{isLogin:true,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}}));
  if(url.includes('/view'))return new Response(JSON.stringify({code:0,data:{bvid:'BV1xx411c7mD',title:'视频',pages:[{cid:11,duration:1},{cid:22,duration:2}],rights:{}}}));
  if(url.includes('/playurl'))return new Response(JSON.stringify({code:0,data:{quality:32,durl:[{url:'https://cdn.bilivideo.com/a',size:128}]}}));
  return new Response(Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(116)]));
 };
 await plugin.plugin_init(ctx);await plugin.plugin_set_config(ctx,{requestGapMs:500});
 const event={post_type:'message',message_type:'group',self_id:99,user_id:123,group_id:456,message_id:88,message:[{type:'text',data:{text:'/bili下载 BV1xx411c7mD P2'}}]};
 await plugin.plugin_onmessage(ctx,event);await plugin.plugin_onmessage(ctx,event);
 let jobs;for(let i=0;i<100;i++){jobs=(await call('GET','/downloads')).data.jobs;if(jobs[0]?.status==='done'||jobs[0]?.status==='error')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(jobs.length,1);assert.equal(jobs[0].status,'done',jobs[0].error);assert.equal(jobs[0].page,2);
 assert.equal(sent.length,2);assert.equal(sent[1][1].group_id,'456');assert.equal(sent[1][1].message[0].type,'video');assert.match(sent[1][1].message[0].data.file,/^file:\/\//);
 assert.equal(new URL(calls.find(c=>c.url.includes('/playurl')).url).searchParams.get('cid'),'22');
 assert.equal(calls.find(c=>c.url.includes('bilivideo.com')).options.headers.Cookie,undefined);
 assert.equal((await call('POST','/downloads/start',{input:'https://127.0.0.1/private'})).code,-1);
 const raw=new EventEmitter(),headers={};let savedPath;
 await routes.get('GET /downloads/file/:id')({params:{id:jobs[0].id}},{raw,setHeader(k,v){headers[k]=v;},sendFile(file){savedPath=file;},status(){return this;},json(){assert.fail('文件路由不应失败');}});
 assert.equal(headers['Content-Type'],'video/mp4');assert((await fs.stat(savedPath)).isFile());
 assert.equal((await call('POST','/downloads/clear',{})).code,-1);raw.emit('finish');
 // done becomes visible before the task metadata write and worker cleanup finish.
 let cleared;for(let i=0;i<100;i++){cleared=await call('POST','/downloads/clear',{});if(cleared.code===0)break;await new Promise(r=>setTimeout(r,10));}assert.equal(cleared.code,0);
});
test('现有账号页的自检接口异步返回结果，报告脱敏且不发送 QQ',async t=>{
 const {ctx,call,sent}=await setup(t);globalThis.fetch=async()=>new Response(null,{status:412});await plugin.plugin_init(ctx);
 const start=await call('POST','/diagnostics/start',{input:'BV1xx411c7mD',mode:'session'});assert.equal(start.code,0);
 let data;for(let i=0;i<40;i++){data=(await call('GET','/diagnostics')).data;if(data.report.status==='done')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(data.report.rows[0].httpStatus,412);assert(data.report.rows.slice(1).every(r=>r.status==='blocked'));assert(!JSON.stringify(data).includes('secret-session'));assert.equal(sent.length,0);
});
test('二维码地址校验错误在 WebUI 给出原因，日志不记录原始地址或密钥',async t=>{
 const {ctx,call}=await setup(t);globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{url:'javascript:SECRET_KEY',qrcode_key:'SECRET_KEY'}}));await plugin.plugin_init(ctx);
 const result=await call('POST','/account/qr',{});assert.equal(result.code,-1);assert.match(result.message,/UNSUPPORTED_SCHEME/);assert(!result.message.includes('SECRET_KEY'));
 const diagnostic=(await call('GET','/diagnostics')).data;assert(diagnostic.traces.some(r=>r.error==='LOGIN_QR_URL'&&r.httpStatus===200));assert(!JSON.stringify(diagnostic).includes('SECRET_KEY'));assert(!JSON.stringify(await call('GET','/logs')).includes('SECRET_KEY'));
});

test('直播 WebUI 路由验证订阅、保存设置和删除，初始化不发送 QQ',async t=>{
 const {ctx,call,sent}=await setup(t);
 globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.hostname,'api.live.bilibili.com');assert.equal(u.pathname,'/room/v1/Room/get_status_info_by_uids');assert.equal(u.searchParams.get('uids[]'),'123');return new Response(JSON.stringify({code:0,data:{'123':{room_id:456,uname:'主播',title:'直播',live_status:1,live_time:0}}}));};
 await plugin.plugin_init(ctx);
 let d=(await call('GET','/live')).data;assert.equal(d.enabled,false);
 const added=await call('POST','/live/subscription',{revision:d.revision,input:'123',type:'uid',label:'测试',groups:['123'],enabled:true,start:true,end:true});assert.equal(added.code,0,added.message);d=added.data;assert.equal(d.subscriptions.length,1);
 const enabled=await call('POST','/live/settings',{revision:d.revision,enabled:true,intervalSeconds:60});assert.equal(enabled.code,0);d=enabled.data;
 assert.equal((await call('POST','/live/remove',{revision:0,uid:'123'})).code,-1);
 assert.equal((await call('POST','/live/subscription',{revision:d.revision,input:'https://evil.example/1',type:'uid',groups:['123'],enabled:true,start:true,end:true})).code,-1);
 const removed=await call('POST','/live/remove',{revision:d.revision,uid:'123'});assert.equal(removed.code,0);assert.equal(removed.data.subscriptions.length,0);assert.equal(sent.length,0);
});

test('通知卡片接口：状态、预览与自检都走鉴权路由，不发送 QQ',async t=>{
 const http=await import('node:http');
 const TINY=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
 const server=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(TINY);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const realFetch=globalThis.fetch;
 const {ctx,call,sent}=await setup(t);
 // setup() 把 globalThis.fetch 换成了 B站接口的替身；这里只放行本机 mock 渲染服务。
 globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:String(input?.url||'');
  if(url.startsWith(base))return realFetch(input,init);
  return new Response(JSON.stringify({code:0,data:{'123':{room_id:'456',uname:'主播',title:'直播',live_status:0,live_time:0}}}));
 };
 const current=await plugin.plugin_get_config(ctx);
 await plugin.plugin_set_config(ctx,{...current,liveCardRenderUrl:base});
 await plugin.plugin_init(ctx);
 const d=(await call('GET','/live/card')).data;
 assert.equal(d.configured,true);assert.equal(d.enabled,true);assert.equal(d.persona,'amis');assert(d.personas.some(x=>x.key==='plain'));assert(d.themes.includes('min'));assert.equal(d.hint,'');
 const preview=await call('POST','/live/card/preview',{kind:'end'});
 assert.equal(preview.code,0,preview.message);
 assert.match(preview.data.image,/^data:image\/jpeg;base64,/);
 assert.ok(preview.data.bytes>0);assert.match(preview.data.text,/朱朱白白喵/);
 const check=await call('POST','/live/card/test',{});
 assert.equal(check.code,0);assert.equal(check.data.ok,true);assert.ok(check.data.bytes>0);
 const current2=await plugin.plugin_get_config(ctx);
 await plugin.plugin_set_config(ctx,{...current2,liveCardRenderUrl:''});
 await plugin.plugin_init(ctx);
 assert.equal((await call('POST','/live/card/preview',{kind:'start'})).code,-1);
 assert.equal(sent.length,0,'卡片预览与自检都不能向 QQ 发送消息');
});
test('直播手动控制和补发走鉴权路由，停止检测后补发不请求 B站',async t=>{
 const {ctx,call,sent}=await setup(t);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:0,data:{'123':{room_id:456,uname:'主播',title:'直播标题',live_status:0,live_time:0}}}));};
 await plugin.plugin_init(ctx);let d=(await call('POST','/live/subscription',{revision:0,input:'123',type:'uid',label:'',groups:['123'],enabled:true,start:true,end:true})).data;
 d=(await call('POST','/live/settings',{revision:d.revision,enabled:true,intervalSeconds:60,scheduleEnabled:true,startTime:'22:00',endTime:'02:00',continueUntilEnd:true})).data;
 d=(await call('POST','/live/control',{revision:d.revision,action:'stop'})).data;assert.equal(d.control,'stopped');const before=calls;
 const r=await call('POST','/live/notify',{revision:d.revision,uid:'123',kind:'start'});assert.equal(r.code,0,r.message);
 for(let i=0;i<100;i++){d=(await call('GET','/live')).data;if(!d.manualSending.length)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(calls,before);assert.equal(sent.length,1);assert.equal(sent[0][0],'send_msg');assert.equal(sent[0][1].group_id,'123');assert.match(sent[0][1].message[0].data.text,/开播通知/);assert.equal(d.control,'stopped');assert.equal(d.records[0].status,'sent');
 const logs=JSON.stringify(await call('GET','/logs'));for(const marker of ['收到手动通知请求','已排队','正在发送','发送成功'])assert(logs.includes(marker),marker);
 assert.equal((await call('POST','/live/notify',{revision:0,uid:'123',kind:'end'})).code,-1);assert.match(JSON.stringify(await call('GET','/logs')),/请求未完成/);
 assert.equal((await call('POST','/live/control',{revision:0,action:'auto'})).code,-1);
 assert.equal((await call('POST','/live/settings',{revision:d.revision,enabled:true,intervalSeconds:60,scheduleEnabled:true,startTime:'22:00',endTime:'22:00'})).code,-1);
});

test('常规请求只在调试时输出，错误和诊断轨迹保留',async t=>{
 const {ctx,call}=await setup(t);await call('POST','/preview',{input:'BV1xx411c7mD'});let logs=JSON.stringify(await call('GET','/logs'));assert(!logs.includes('[BILI][REQUEST]'));assert(!logs.includes('[BILI][RESPONSE]'));assert((await call('GET','/diagnostics')).data.traces.some(r=>r.phase==='RESPONSE'));
 await plugin.plugin_set_config(ctx,{debug:true});await call('POST','/preview',{input:'BV1xx411c7mD'});logs=JSON.stringify(await call('GET','/logs'));assert(logs.includes('[BILI][REQUEST]'));assert(logs.includes('[BILI][RESPONSE]'));
 globalThis.fetch=async()=>new Response(null,{status:412});await plugin.plugin_set_config(ctx,{debug:false});await call('POST','/preview',{input:'BV1xx411c7mD'});assert.match(JSON.stringify(await call('GET','/logs')),/\[BILI\]\[RISK\]/);
});
