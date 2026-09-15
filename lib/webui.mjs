import fs from 'node:fs/promises';
import {defaults,ids} from './config.mjs';
import {extract,labels} from './parser.mjs';
import {formatInfo,publicError} from './bili.mjs';
import {downloadError} from './downloads.mjs';
import {liveCardData,collectCardImages,renderHint,personaLabel,personas,themes} from './live-card.mjs';
export const VERSION='1.5.5';
export function record(s,item){s.records.unshift({time:Date.now(),...item});s.records.length=Math.min(s.records.length,200);}
export function publicConfig(s){const {cookie,...config}=s.config;return {config,cookieConfigured:!!cookie,revision:s.revision};}
function fail(code,message){const e=new Error(message);e.httpStatus=code;return e;}
export function registerWebUI(ctx,getState,updateConfig,log){
 const router=ctx.router;if(!router?.page||!router?.get||!router?.post){log('warn','当前 NapCat 未提供 WebUI 路由，请更新 NapCat。');return;}
 router.static('/static','webui');
 router.page({path:'dashboard',title:'B站识别控制台',htmlFile:'webui/index.html',description:'状态、配置、群管理与链接测试'});
 const route=(method,url,handler)=>router[method](url,async(req,res)=>{
  const s=getState();if(!s||s.closed)return res.status(503).json({code:-1,message:'插件正在重载，请稍后刷新。'});
  try {res.setHeader?.('Cache-Control','no-store');const data=await handler(s,req);res.json({code:0,data});}
  catch(e){res.status(e.httpStatus||500).json({code:-1,message:e.httpStatus?e.message:'操作失败，请查看 NapCat 日志。'});if(!e.httpStatus)log('warn',`WebUI 操作失败：${url}；${String(e.code||e.name).slice(0,50)}`);}
 });
 const body=req=>{const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))throw fail(400,'请求参数格式错误。');return b;};
 const overview=s=>({version:VERSION,uptime:Date.now()-s.startedAt,enabled:s.config.enabled,groupEnabled:s.config.groupEnabled,privateEnabled:s.config.privateEnabled,cookieConfigured:!!s.config.cookie,groupMode:s.config.groupMode,cooldownSeconds:s.config.cooldownSeconds,active:s.active,previewActive:s.previewActive,stats:s.stats,cacheCount:[...s.client.cache.values()].filter(x=>x.until>Date.now()).length,recordCount:s.records.length,risk:s.gate?.snapshot(),downloadMode:s.config.downloadMode});
 route('get','/status',overview);
 route('get','/overview',s=>({status:overview(s),records:s.records.slice(0,4)}));
 route('get','/config',s=>publicConfig(s));
 route('get','/live',s=>({...s.live.snapshot(true),risk:s.gate.snapshot()}));
 route('post','/live/settings',(s,req)=>s.live.settings(body(req)));
 route('post','/live/control',(s,req)=>s.live.control(body(req)));
 route('post','/live/notify',async(s,req)=>{try{return await s.live.manualNotify(body(req));}catch(e){log('warn',`[LIVE][MANUAL] 请求未完成：${e.httpStatus?e.message:'后台处理异常，请检查数据目录及发送状态。'}`);throw e;}});
 route('post','/live/subscription',(s,req)=>s.live.upsert(body(req)));
 route('post','/live/remove',(s,req)=>s.live.remove(body(req)));
 // 卡片预览与自检：预览用示例数据渲染，不请求 B站，也不向 QQ 发送任何消息。
 route('get','/live/card',s=>({enabled:!!s.config.liveCard,configured:!!s.config.liveCardRenderUrl,renderUrl:s.config.liveCardRenderUrl,mode:s.config.liveCardRenderMode,persona:s.config.liveCardPersona,personaLabel:personaLabel(s.config.liveCardPersona),personas:personas.map(key=>({key,label:personaLabel(key)})),theme:s.config.liveCardTheme,themes,decor:s.config.liveCardDecor,avatarPosition:s.config.liveCardAvatarPosition,timeoutSeconds:s.config.liveCardRenderTimeoutSeconds,status:s.live.card.status_(),hint:s.config.liveCardRenderUrl?'':renderHint('OFF')}));
 route('post','/live/card/preview',async(s,req)=>{
  const b=body(req);const kind=b.kind==='end'?'end':'start';const theme=themes.includes(b.theme)?b.theme:(s.config.liveCardTheme||'amis');
  const persona=personas.includes(b.persona)?b.persona:(s.config.liveCardPersona||'amis');
  if(!s.config.liveCardRenderUrl)throw fail(400,renderHint('OFF'));
  const now=Date.now();
  const sub={uid:'27665992',label:'朱朱白白喵',groups:[],start:true,end:true};
  const state={uid:'27665992',roomId:'27665992',name:'朱朱白白喵',title:'深塔海墟全都打不过！',status:1,startAt:now-(kind==='end'?2*3600*1000+56*60*1000:0),areaName:'虚拟主播'};
  const card=liveCardData(sub,state,kind,now,{persona,avatarPosition:s.config.liveCardAvatarPosition});
  const images=await collectCardImages(s.client,{...card,coverSource:'',avatarSource:'',cover:'',avatar:''},{stickerDir:s.live.card.assetDir,decor:s.config.liveCardDecor});
  const result=await s.live.card.render({...card,cover:images.cover,avatar:images.avatar,qr:images.qr},{force:true});
  if(!result.ok)throw fail(400,result.hint||renderHint(result.reason));
  const buffer=await fs.readFile(result.file);
  return {image:`data:image/jpeg;base64,${buffer.toString('base64')}`,bytes:buffer.length,theme,persona,text:card.reply,stickers:Object.fromEntries(Object.entries(images.stickers||{}).map(([key,list])=>[key,list.length])),stickerProblems:images.problems||[]};
 });
 route('post','/live/card/test',async s=>{const result=await s.live.card.test();return {renderUrl:s.config.liveCardRenderUrl,...result};});
 route('get','/diagnostics/summary',s=>({report:s.diagnostics.report,risk:s.gate.snapshot()}));
 route('get','/diagnostics',s=>({report:s.diagnostics.report,traces:s.traces,risk:s.gate.snapshot()}));
 route('post','/diagnostics/start',(s,req)=>{const b=body(req);if(typeof b.input!=='string'||b.input.length>2000)throw fail(400,'请输入 BV / AV 或普通视频链接。');try{return s.diagnostics.start(b.input,b.mode||'session');}catch(e){throw fail(409,e.message);}});
 route('get','/account',s=>({...s.login.status(),risk:s.gate.snapshot()}));
 route('post','/account/check',async s=>({...await s.login.check(),risk:s.gate.snapshot()}));
 const qrReasons={MISSING_URL:'缺少二维码地址',URL_TOO_LONG:'地址长度超限',INVALID_CHARACTERS:'地址含无效字符',INVALID_URL:'地址无法解析',UNSUPPORTED_SCHEME:'协议不受支持',USERINFO_NOT_ALLOWED:'地址包含用户信息',PORT_NOT_ALLOWED:'地址使用非标准端口'};
 const missing=e=>(e.missingCookies||[]).filter(k=>['SESSDATA','bili_jct','DedeUserID'].includes(k)).join('、');
 const loginMessage=e=>e.code==='LOGIN_URL'&&e.reason==='REDIRECT_TARGET_REJECTED'?`扫码已确认，但换票跳转受阻；尚缺 ${missing(e)||'有效登录凭据'}。请导出登录诊断。`:e.code==='LOGIN_COOKIES'&&e.reason==='INCOMPLETE_COOKIES'?`扫码已确认，但未获取到完整凭据；尚缺 ${missing(e)||'有效登录凭据'}。请导出登录诊断。`:e.code==='LOGIN_QR_URL'?`二维码内容校验失败：${qrReasons[e.reason]||'格式不受支持'}（${e.reason in qrReasons?e.reason:'UNKNOWN'}）。这不是 412，请把此提示发给开发者。`:({LOGIN_REDIRECT_LIMIT:'扫码已确认，但换票跳转次数过多，尚未获得完整凭据。请导出登录诊断。',LOGIN_WAIT:'请稍候再生成二维码。',LOGIN_SESSION:'二维码已取消或登录状态已变化，请重新生成。',LOGIN_COOKIES:'扫码已确认，但未获取到完整凭据，请重新生成二维码。',LOGIN_FORMAT:'B站未返回完整的二维码信息，请稍后重试。',LOGIN_QR_RENDER:'B站已返回二维码地址，但本地二维码绘制失败，请查看登录诊断。',LOGIN_URL:'登录换票地址不受支持，请查看登录诊断。'}[e.code]||publicError(e));
 route('post','/account/qr',async s=>{try{return await s.login.generate();}catch(e){throw fail(400,loginMessage(e));}});
 route('post','/account/poll',async(s,req)=>{const b=body(req);if(typeof b.sessionId!=='string')throw fail(400,'缺少二维码会话。');try{return await s.login.poll(b.sessionId);}catch(e){throw fail(400,loginMessage(e));}});
 route('post','/account/cancel',s=>{s.login.cancel();return {cancelled:true};});
 route('post','/account/remove',async s=>{s.login.cancel();await updateConfig(()=>({cookie:''}));log('info','已移除本插件保存的 B站登录。');return {removed:true};});
 route('get','/downloads',s=>({jobs:s.downloads.list(),config:{mode:s.config.downloadMode,quality:s.config.downloadQuality,maxMB:s.config.downloadMaxMB,maxSeconds:s.config.downloadMaxSeconds,keepHours:s.config.downloadKeepHours},risk:s.gate.snapshot()}));
 route('get','/downloads/diagnostic/:id',(s,req)=>{const job=s.downloads.list().find(j=>j.id===req.params?.id);if(!job)throw fail(404,'下载任务不存在。');return {version:VERSION,exportedAt:Date.now(),job,traces:s.traces.filter(r=>r.jobId===job.id)};});
 route('post','/downloads/engine',s=>s.downloads.engine(true));
 route('post','/downloads/start',(s,req)=>{const b=body(req);if(typeof b.input!=='string'||b.input.length>2000)throw fail(400,'请输入视频链接或编号。');try{return s.downloads.enqueue(b.input,{page:b.page===undefined?1:Number(b.page)});}catch(e){throw fail(400,downloadError(e));}});
 route('post','/downloads/cancel',(s,req)=>{try{return s.downloads.cancel(body(req).id);}catch(e){throw fail(400,downloadError(e));}});
 route('post','/downloads/clear',async s=>{try{return await s.downloads.clear();}catch(e){throw fail(409,'仍有任务或文件传输，请稍后清理。');}});
 router.get('/downloads/file/:id',async(req,res)=>{
  const s=getState();let leased;
  try{if(!s||s.closed)throw new Error('closed');leased=await s.downloads.file(req.params?.id);
   res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Disposition',`attachment; filename="${leased.name}"`);res.setHeader('Cache-Control','no-store');
   const raw=res.raw;if(raw?.once){raw.once('finish',leased.release);raw.once('close',leased.release);}else{const timer=setTimeout(leased.release,120000);timer.unref?.();}
   res.sendFile(leased.path);
  }catch{leased?.release();res.status(404).json({code:-1,message:'文件不存在或已过期，请重新下载。'});}
 });

 route('post','/config',async(s,req)=>{
  const b=body(req);if(!b.config||typeof b.config!=='object'||Array.isArray(b.config))throw fail(400,'缺少配置。');
  for(const key of Object.keys(b.config))if(!(key in defaults))throw fail(400,`未知配置项：${key.slice(0,40)}`);
  if(!Number.isInteger(b.revision))throw fail(400,'缺少配置版本，请刷新页面。');
  if(!['keep','replace','clear'].includes(b.cookieAction||'keep'))throw fail(400,'Cookie 操作无效。');
  await updateConfig(current=>{
   if(current.revision!==b.revision)throw fail(409,'配置已在其他页面修改，请重新加载后再保存。');
   const patch={...b.config};delete patch.cookie;
   if(b.cookieAction==='clear')patch.cookie='';
   if(b.cookieAction==='replace'){if(typeof b.config.cookie!=='string'||!b.config.cookie.trim())throw fail(400,'请先填写新的 Cookie。');patch.cookie=b.config.cookie;}
   return patch;
  });return publicConfig(getState());
 });
 route('get','/groups',async s=>{
  const result=await ctx.actions.call('get_group_list',{},ctx.adapterName,ctx.pluginManager.config);
  const list=Array.isArray(result)?result:result?.data;
  if(!Array.isArray(list))throw fail(502,'未获取到群列表，请确认机器人已登录。');
  const selected=ids(s.config.groupIds);
  return {groupEnabled:s.config.groupEnabled,mode:s.config.groupMode,groups:list.map(g=>({id:String(g.group_id),name:String(g.group_name||''),members:g.member_count??0,enabled:s.config.groupMode==='all'||(s.config.groupMode==='allow'?selected.has(String(g.group_id)):!selected.has(String(g.group_id)))}))};
 });
 route('post','/groups/toggle',async(s,req)=>{
  const b=body(req);if(typeof b.id!=='string'||!/^\d+$/.test(b.id)||typeof b.enabled!=='boolean')throw fail(400,'群号或开关值无效。');
  await updateConfig(current=>{let mode=current.config.groupMode;let selected=ids(current.config.groupIds);if(mode==='all'){if(b.enabled)return {};mode='deny';selected=new Set();}
   if((mode==='allow'&&b.enabled)||(mode==='deny'&&!b.enabled))selected.add(b.id);else selected.delete(b.id);
   return {groupMode:mode,groupIds:[...selected].join('\n')};});return {saved:true};
 });
 route('get','/records',s=>({records:s.records}));
 route('get','/logs',s=>({logs:s.logs}));
 route('get','/cache',s=>({items:[...s.client.cache.entries()].filter(([,v])=>v.until>Date.now()).map(([key,v])=>({key,title:v.value.title,type:labels[v.value.type]||v.value.type,url:v.value.url,expiresAt:v.until})),cooldownCount:[...s.seen.values()].filter(x=>x>Date.now()).length}));
 route('post','/cache/clear',s=>{if(s.active||s.previewActive)throw fail(409,'正在解析，请等任务结束后清理。');s.client.cache.clear();s.seen.clear();s.events.clear();s.errors.clear();log('info','已清除内容缓存和重复回复冷却。');return {cleared:true};});
 route('post','/preview',async(s,req)=>{
  const b=body(req);if(typeof b.input!=='string'||b.input.length>2000)throw fail(400,'请输入不超过 2000 字的 B站链接或编号。');
  const links=extract(b.input,true);if(!links.length)throw fail(400,'没有识别到 B站链接或编号。');
  if(s.previewActive>=2)throw fail(429,'已有两个测试任务，请稍后再试。');
  s.previewActive++;const client=s.client,config={...s.config};const result=[];
  try {for(const input of links.slice(0,config.maxLinks)){
   const started=Date.now();try{
    const link=await client.resolve(input),info=await client.info(link);
    if(s.closed||s.client!==client)throw fail(409,'配置已更新或插件已重载，请重新测试。');
    const text=formatInfo(info,config);result.push({ok:true,type:labels[info.type],title:info.title,url:info.url,images:config.showCover?info.images:[],text,limited:!!info.limited});
    s.stats.tests++;record(s,{source:'webui',outcome:'success',type:labels[info.type],title:info.title,url:info.url,duration:Date.now()-started});
   }catch(e){if(e.httpStatus)throw e;const message=publicError(e);result.push({ok:false,type:labels[input.type]||'短链',message});s.stats.testFailed++;record(s,{source:'webui',outcome:'error',type:labels[input.type]||'短链',title:message,duration:Date.now()-started});log('warn',`链接测试失败：${input.type}；${String(e.code||e.name).slice(0,50)}`);}
  }return {results:result};}finally{s.previewActive--;}
 });
}
