import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {BiliClient} from '../lib/bili.mjs';
import {RequestGate} from '../lib/net.mjs';
import {defaults} from '../lib/config.mjs';
import {CookieJar,SessionStore} from '../lib/cookies.mjs';
import {QrLogin} from '../lib/login.mjs';
import {mixinKey,signWbi,makeDm} from '../lib/wbi.mjs';
import {ConnectionCheck} from '../lib/diagnostics.mjs';
import {traceLine} from '../lib/trace.mjs';
import {extract} from '../lib/parser.mjs';
const BV='BV1xx411c7mD';
const images={img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'};
const json=(data,code=0,headers={})=>new Response(JSON.stringify({code,data}),{headers});
const config={...defaults,requestGapMs:0,cookie:'SESSDATA=SECRET_SESSION; bili_jct=SECRET_CSRF; DedeUserID=123; buvid3=DEVICE_STABLE'};
test('WBI 的排序、过滤、空格/中文/~ 编码与独立 Python 参考值一致',()=>{
 const key=mixinKey(images.img_url,images.sub_url);assert.equal(key,'ea1db124af3c7062474693fa704f4ff8');
 const params={bvid:BV,cid:'22',dm_img_list:'[]',dm_img_inter:'{"ds":[],"wh":[6000,7000,1],"of":[1,2,3]}',x:"a b~!'()*中"};
 const signed=signWbi(params,key,1702204169000);assert.equal(signed.params.w_rid,'72037d99ea8050b350d4033df0233a43');assert.match(signed.query,/x=a\+b~%E4%B8%AD/);
 assert.notEqual(signWbi({...params,dm_img_list:'[1]'},key,1702204169000).params.w_rid,signed.params.w_rid);assert.equal(params.x,"a b~!'()*中");
});
test('实际 playurl 请求的所有 dm 字段参与签名、凭据进入 API，信息识别不预取 playurl',async()=>{
 const calls=[],traces=[];const c=new BiliClient(config,async(url,options)=>{calls.push({url,options});if(url.includes('/nav'))return json({wbi_img:images,isLogin:true});if(url.includes('/view'))return json({bvid:BV,title:'视频',cid:22,pages:[{cid:22}]});return json({quality:32,durl:[{url:'https://cdn.bilivideo.com/test'}]});},null,{onTrace:r=>traces.push(r)});
 await c.info(extract(BV)[0]);assert.equal(calls.length,1);await Promise.all([c.playInfo(BV,22),c.playInfo(BV,22)]);await c.playInfo(BV,22);assert.equal(calls.length,3);
 const call=calls[2],u=new URL(call.url);assert.equal(u.pathname,'/x/player/wbi/playurl');assert.equal(call.options.headers.Referer,`https://www.bilibili.com/video/${BV}/`);assert.equal(call.options.headers.Cookie,config.cookie);
 for(const name of ['dm_img_list','dm_img_str','dm_cover_img_str','dm_img_inter'])assert(u.searchParams.has(name));const params=Object.fromEntries(u.searchParams);const rid=params.w_rid;delete params.w_rid;assert.equal(signWbi(params,c.wbi.key,Number(params.wts)*1000).params.w_rid,rid);
 assert(!JSON.stringify(traces).includes('SECRET_SESSION'));assert(!JSON.stringify(traces).includes('DEVICE_STABLE'));assert(traces.some(r=>r.login&&r.wbi));c.close();
});
test('匿名 NAV 的 -101 响应仍可提供 WBI key；不将未登录误当做风控',async()=>{
 const gate=new RequestGate(()=>config);let calls=0;const c=new BiliClient({...config,cookie:''},async url=>{calls++;return url.includes('/nav')?json({isLogin:false,wbi_img:images},-101):json({quality:32});},gate);
 await c.playInfo(BV,22);assert.equal(calls,2);assert.equal(gate.until,0);c.close();
});
test('412 日志区分 HTTP/JSON，保留失败接口且不自动切换旧接口重试',async()=>{
 for(const variant of [412,-412]){
  const traces=[],calls=[];const gate=new RequestGate(()=>config);const c=new BiliClient(config,async url=>{calls.push(url);return url.includes('/nav')?json({wbi_img:images}):variant===412?new Response(null,{status:412}):json(null,-412);},gate,{onTrace:r=>traces.push(r)});
  await assert.rejects(c.playInfo(BV,22));await assert.rejects(c.playInfo(BV,22),{code:'BACKOFF'});assert.equal(calls.length,2);assert(calls.every(u=>!u.includes('/x/player/playurl?')));
  const risk=traces.find(r=>r.phase==='RISK');assert.equal(risk.endpoint,'/x/player/wbi/playurl');assert.equal(risk.httpStatus,variant===412?412:200);assert.equal(risk.biliCode,variant===412?null:-412);assert.match(traceLine(risk),/HTTP_STATUS=/);assert(!JSON.stringify(traces).includes('SECRET_CSRF'));c.close();
 }
});
test('CookieJar 保留设备 Cookie，按 Domain/Path/过期规则发送，拒绝跨站 Cookie',()=>{
 const jar=new CookieJar(),h=new Headers();for(const line of ['buvid3=STABLE; Domain=.bilibili.com; Path=/; Secure','b_nut=123; Domain=.bilibili.com; Path=/','b_lsid=456; Domain=.bilibili.com; Path=/','new_device=EXTRA; Domain=.bilibili.com; Path=/','only_host=HOST; Path=/','path_cookie=PATH; Domain=.bilibili.com; Path=/x/player','evil=NO; Domain=evil.example; Path=/','gone=OLD; Domain=.bilibili.com; Path=/; Max-Age=0'])h.append('set-cookie',line);
 jar.ingest(h,'https://passport.bilibili.com/login');const api=jar.header('https://api.bilibili.com/x/web-interface/nav');for(const name of ['buvid3','b_nut','b_lsid','new_device'])assert(api.includes(name+'='));for(const name of ['only_host','path_cookie','evil','gone'])assert(!api.includes(name+'='));assert(jar.header('https://api.bilibili.com/x/player/playurl').includes('path_cookie=PATH'));assert.equal(jar.header('https://cdn.bilivideo.com/file'),'');assert.equal(jar.header('https://passport.biligame.com/'),'');
});
test('扫码各阶段的设备 Cookie 和 refresh_token 持久化，重启后继续进入 API',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bili-session-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const session=new SessionStore(root,'');await session.init();const state={config:{...config,cookie:''},session};state.client=new BiliClient(state.config);
 const qr=new QrLogin(()=>state,async(cookie,expected,valid,snapshot)=>{assert(valid());state.config.cookie=cookie;await session.reset(cookie,snapshot);},async url=>{
  if(url.includes('/generate'))return json({qrcode_key:'SECRET_QR',url:'https://passport.bilibili.com/h5-app/passport/login/scan?key=x'},0,{'set-cookie':'b_nut=1717; Domain=.bilibili.com; Path=/'});
  const h=new Headers();for(const line of ['SESSDATA=SECRET_SESSION','bili_jct=SECRET_CSRF','DedeUserID=123','buvid3=STABLE','b_lsid=LOCAL','new_device=EXTRA'])h.append('set-cookie',line+'; Domain=.bilibili.com; Path=/');return json({code:0,refresh_token:'SECRET_REFRESH'},0,h);
 });const g=await qr.generate();await qr.poll(g.sessionId);session.dm=makeDm();await session.save();qr.close();state.client.close();
 const restored=new SessionStore(root,state.config.cookie);await restored.init();assert(restored.loaded);assert.equal(restored.refreshToken,'SECRET_REFRESH');assert.deepEqual(restored.dm,session.dm);
 const c=new BiliClient(state.config,async(url,opts)=>{for(const name of ['SESSDATA','bili_jct','buvid3','b_nut','b_lsid','new_device'])assert(opts.headers.Cookie.includes(name+'='));return json({isLogin:true});},null,{jar:restored.jar});await c.api('/x/web-interface/nav');c.close();
 if(process.platform!=='win32')assert.equal((await fs.stat(session.file)).mode&0o777,0o600);
 const loggedOut=new SessionStore(root,'');await loggedOut.init();assert.equal(loggedOut.jar.header('https://api.bilibili.com/'),'');
});
test('短链并发合并和缓存，重复分享只解析一次且不携带 Cookie',async()=>{
 let calls=0;const c=new BiliClient(config,async(url,opts)=>{calls++;assert.equal(opts.headers.Cookie,undefined);return new Response(null,{status:302,headers:{location:`https://www.bilibili.com/video/${BV}`}});});const link=extract('https://b23.tv/abc')[0];await Promise.all([c.resolve(link),c.resolve(link)]);await c.resolve(link);assert.equal(calls,1);c.close();
});
function checkFixture(fetcher){const traces=[];const session={jar:new CookieJar(),dm:makeDm()};session.jar.importLegacy(config.cookie);const state={config,session,gate:new RequestGate(()=>config),onTrace:r=>traces.push(r)};const check=new ConnectionCheck(()=>state,{fetcher});return {check,state,traces};}
test('接口矩阵在 VIEW code=-412 后停止，后续行是未请求而不是误报全站 412',async()=>{
 const calls=[];const {check,traces}=checkFixture(async url=>{calls.push(url);if(url==='https://www.bilibili.com/')return new Response('html');if(url.includes('/nav'))return json({isLogin:true,wbi_img:images});return json(null,-412);});check.start(BV,'both');await check.task;const rows=check.report.rows;assert.equal(calls.length,3);assert.equal(rows[2].status,'risk');assert.equal(rows[2].httpStatus,200);assert.equal(rows[2].biliCode,-412);assert(rows.slice(3).every(r=>r.status==='blocked'&&r.httpStatus===null));assert.match(check.report.conclusion,/VIEW|view/);assert(!JSON.stringify({report:check.report,traces}).includes('SECRET_SESSION'));await check.close();
});
test('接口矩阵成功、未登录状态、WBI 和 HTTP 连接失败被分别记录',async()=>{
 const {check}=checkFixture(async(url,opts)=>{if(url==='https://www.bilibili.com/')return new Response('html');if(url.includes('/nav'))return json({isLogin:!!opts.headers.Cookie,wbi_img:images},opts.headers.Cookie?0:-101);if(url.includes('/view'))return json({bvid:BV,cid:22});return json({});});check.start(BV,'both');await check.task;assert.equal(check.report.rows.length,10);assert.equal(check.report.rows[1].status,'anonymous');assert.equal(check.report.rows[6].accountValid,true);assert(check.report.rows[4].wbi);assert(check.report.rows.every(r=>['ok','anonymous'].includes(r.status)));await check.close();
 const failure=checkFixture(async()=>{throw new TypeError('network SECRET_SESSION');});failure.check.start(BV);await failure.check.task;assert(failure.check.report.rows.every(r=>r.httpStatus===null));assert.match(failure.check.report.conclusion,/不能认定/);assert(!JSON.stringify(failure.check.report).includes('SECRET_SESSION'));await failure.check.close();
});
test('服务器诊断 CLI 生成脱敏报告与正确退出码，不改写账号文件',async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {pathToFileURL}=await import('node:url');const exec=promisify(execFile);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const loader=path.join(dir,'mock.mjs'),output=path.join(dir,'result.json');
 await fs.writeFile(loader,"globalThis.fetch=async()=>new Response(null,{status:412});");
 let failure;try{await exec(process.execPath,['--import',pathToFileURL(loader).href,'tools/diagnose-412.mjs',BV,'--mode','anonymous','--output',output],{cwd:new URL('..',import.meta.url).pathname});}catch(e){failure=e;}
 assert.equal(failure?.code,2);const report=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(report.report.rows[0].httpStatus,412);assert.equal(report.report.rows[1].status,'blocked');assert.equal(report.environment.sessionFileLoaded,false);assert(!JSON.stringify(report).includes('SESSDATA='));
});
