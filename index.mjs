import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults,normalize,schema,ids} from './lib/config.mjs';
import {messageText,extract} from './lib/parser.mjs';
import {BiliClient,formatInfo,publicError} from './lib/bili.mjs';
import {registerWebUI,record,VERSION} from './lib/webui.mjs';
import {RequestGate,BiliError} from './lib/net.mjs';
import {SessionStore} from './lib/cookies.mjs';
import {ConnectionCheck} from './lib/diagnostics.mjs';
import {traceLine} from './lib/trace.mjs';
import {makeDm,validDm} from './lib/wbi.mjs';
import {QrLogin} from './lib/login.mjs';
import {DownloadManager,downloadError} from './lib/downloads.mjs';
import {LiveMonitor} from './lib/live.mjs';
export const plugin_config_ui=schema;
const states=new Map();
const stateKey=ctx=>ctx.configPath||ctx.pluginPath;
// 插件自身目录：卡片模板与自备贴纸都在这里，与数据目录无关。
const pluginRoot=path.dirname(fileURLToPath(import.meta.url));
function log(ctx,level,message){const s=states.get(stateKey(ctx));if(s){s.logs.unshift({time:Date.now(),level,message});s.logs.length=Math.min(s.logs.length,200);}const fn=ctx.logger?.[level]||ctx.logger?.log;if(fn)fn.call(ctx.logger,`[B站识别] ${message}`);}
function boundedSet(map,key,value){map.set(key,value);while(map.size>2000)map.delete(map.keys().next().value);}
async function loadConfig(ctx){try{return normalize(JSON.parse(await fs.readFile(ctx.configPath,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;return {...defaults};}}
export async function plugin_init(ctx){
 await plugin_cleanup(ctx);
 const config=await loadConfig(ctx);
 states.set(stateKey(ctx),{config,client:new BiliClient(config),seen:new Map(),locks:new Set(),events:new Map(),errors:new Map(),active:0,closed:false,startedAt:Date.now(),revision:0,writeQueue:Promise.resolve(),previewActive:0,stats:{success:0,failed:0,tests:0,testFailed:0},records:[],logs:[],cards:[]});
 const state=states.get(stateKey(ctx));
 state.gate=new RequestGate(()=>state.config);state.traces=[];
 state.onTrace=row=>{if(row.phase!=='REQUEST'){state.traces.unshift(row);state.traces.length=Math.min(200,state.traces.length);}if(['RISK','ERROR','BLOCKED'].includes(row.phase)||(row.biliCode!=null&&row.biliCode!==0))log(ctx,'warn',traceLine(row));else if(state.config.debug)log(ctx,'debug',traceLine(row));};
 state.session=new SessionStore(ctx.dataPath||path.join(path.dirname(ctx.configPath),'bili-recognizer-data'),config.cookie);await state.session.init();
 if(!validDm(state.session.dm)){state.session.dm=makeDm();await state.session.save();}
 if(state.session.loadFailed)log(ctx,'warn','会话文件读取失败，已使用原配置中的 Cookie；设备状态需要重新验证。');
 state.client.close();state.client=makeClient(state);state.diagnostics=new ConnectionCheck(()=>state);

 state.downloads=new DownloadManager(path.join(ctx.dataPath||path.join(path.dirname(ctx.configPath),'bili-recognizer-data'),'downloads'),()=>state,(level,message)=>log(ctx,level,message));
 await state.downloads.init();
 state.login=new QrLogin(()=>state,async(cookie,expected,stillCurrent,snapshot)=>updateConfig(ctx,current=>{
  if(!stillCurrent()||current.config.cookie!==expected)throw new BiliError('LOGIN_SESSION','登录状态已变化，请重新生成二维码');return {cookie};
 },snapshot));
 state.live=new LiveMonitor(ctx.dataPath||path.join(path.dirname(ctx.configPath),'bili-recognizer-data'),()=>state,(group,payload)=>send(ctx,{message_type:'group',group_id:group},Array.isArray(payload)?payload:[{type:'text',data:{text:payload}}]),(level,message)=>log(ctx,level,message),{assetDir:path.join(pluginRoot,'assets','card')});
 await state.live.init();
 registerWebUI(ctx,()=>states.get(stateKey(ctx)),patch=>updateConfig(ctx,patch),(level,message)=>log(ctx,level,message));
 log(ctx,'info',`已加载 v${VERSION}；B站识别控制台已就绪。`);
}
export async function plugin_get_config(ctx){return {...(states.get(stateKey(ctx))?.config||await loadConfig(ctx))};}
export async function plugin_set_config(ctx,input){return updateConfig(ctx,()=>input);}
async function updateConfig(ctx,makePatch,snapshot=null){
 const state=states.get(stateKey(ctx));if(!state)throw new Error('插件尚未初始化');
 const task=state.writeQueue.catch(()=>{}).then(async()=>{
  if(state.closed)throw new Error('插件已卸载');
  let config;try{config=normalize({...state.config,...makePatch(state)});}catch(e){e.httpStatus=e.httpStatus||400;throw e;}
  await fs.mkdir(path.dirname(ctx.configPath),{recursive:true});
  const temp=ctx.configPath+'.bili-tmp';
  await fs.writeFile(temp,JSON.stringify(config,null,2),{encoding:'utf8',mode:0o600});await fs.rename(temp,ctx.configPath);
  if(state.closed)return;
  const cookieChanged=state.config.cookie!==config.cookie;
  state.client.close();state.config=config;if(cookieChanged||snapshot){await state.session.reset(config.cookie,snapshot);state.session.dm=makeDm();await state.session.save();}state.client=makeClient(state);state.seen.clear();state.revision++;
  if(cookieChanged){await state.diagnostics?.cancel();state.login?.resetAccount();state.downloads?.cancelAll();}
  log(ctx,'info','配置已保存并生效。');
 });state.writeQueue=task;return task;
}
export async function plugin_cleanup(ctx){const s=states.get(stateKey(ctx));if(s){s.closed=true;s.login?.close();s.client.close();await s.live?.close();await s.diagnostics?.close();await s.downloads?.close();s.seen.clear();s.events.clear();s.errors.clear();s.locks.clear();await s.writeQueue.catch(()=>{});await s.session?.flush().catch(()=>{});states.delete(stateKey(ctx));}}
async function send(ctx,event,message){
 const params={message_type:event.message_type,message,...(event.message_type==='group'?{group_id:String(event.group_id)}:{user_id:String(event.user_id)})};
 const r=await ctx.actions.call('send_msg',params,ctx.adapterName,ctx.pluginManager.config);
 if(r?.status==='failed'||(typeof r?.retcode==='number'&&r.retcode!==0))throw new Error('NapCat 返回发送失败');
}
export async function plugin_onmessage(ctx,event){
 const s=states.get(stateKey(ctx));if(!s||s.closed||!s.config.enabled||event.post_type!=='message'||!['group','private'].includes(event.message_type))return;
 if(event.sub_type==='group_self'||String(event.user_id)===String(event.self_id)||!event.user_id)return;
 const c=s.config,isGroup=event.message_type==='group';if((isGroup&&!c.groupEnabled)||(!isGroup&&!c.privateEnabled)||(isGroup&&!event.group_id))return;
 if(ids(c.blockedUsers).has(String(event.user_id)))return;
 const groups=ids(c.groupIds);if(isGroup&&((c.groupMode==='allow'&&!groups.has(String(event.group_id)))||(c.groupMode==='deny'&&groups.has(String(event.group_id)))))return;
 const scope=`${event.message_type}:${isGroup?event.group_id:event.user_id}`;
 const content=messageText(event);
 const command=content.match(/^\s*\/(?:bili下载|下载视频)(?:\s+([\s\S]*))?$/i);
 if(command){
  if(c.downloadMode==='off')return;
  const commandKey=event.message_id!=null?`dl:${scope}:${event.message_id}`:null;
  if(commandKey&&(s.events.get(commandKey)||0)>Date.now())return;
  if(commandKey)boundedSet(s.events,commandKey,Date.now()+60000);
  const input=command[1]||'';
  if(!input){await send(ctx,event,[{type:'text',data:{text:'用法：/bili下载 B站视频链接或BV号 P2（P2 可省略）'}}]);return;}
  try{const pageNumber=Number(input.match(/(?:^|\s)P(\d+)(?:\s|$)/i)?.[1]||input.match(/[?&]p=(\d+)/i)?.[1]||1);
   queueDownload(ctx,s,event,input,pageNumber,false);
   await send(ctx,event,[{type:'text',data:{text:'已加入视频下载队列，完成后发送到当前会话。'}}]);
  }catch(e){await send(ctx,event,[{type:'text',data:{text:downloadError(e)}}]).catch(()=>{});}
  return;
 }
 const links=extract(content,c.bareIds).slice(0,c.maxLinks);if(!links.length)return;
 if(s.active>=4){if(c.debug)log(ctx,'debug','并发解析已达上限，跳过当前消息。');return;}
 const eventKey=event.message_id!=null?`${scope}:${event.message_id}`:null;
 if(eventKey&&(s.events.get(eventKey)||0)>Date.now())return;
 if(eventKey)boundedSet(s.events,eventKey,Date.now()+60000);
 s.active++;
 const client=s.client;
 try{for(const input of links){
  const held=[];let cooldownKey;const started=Date.now();
  const lock=key=>{if(s.locks.has(key)||(s.seen.get(key)||0)>Date.now())return false;s.locks.add(key);held.push(key);return true;};
  try{
   if(!lock(`${scope}:${input.key}`))continue;
   const l=await client.resolve(input);cooldownKey=`${scope}:${l.key}`;
   if(cooldownKey!==held[0]&&!lock(cooldownKey))continue;
   if(c.debug)log(ctx,'debug',`识别 ${l.type} ${l.id}`);
   const d=await client.info(l);
   const finalKey=`${scope}:${d.key}`;if(!held.includes(finalKey)&&!lock(finalKey))continue;
   if(s.closed||s.client!==client)break;
   const text={type:'text',data:{text:formatInfo(d,c)}};
   const images=c.showCover?d.images.map(file=>({type:'image',data:{file}})):[];
   try{await send(ctx,event,[...images,text]);}catch(e){if(!images.length)throw e;log(ctx,'warn','封面消息发送失败，尝试纯文字回复。');await send(ctx,event,[text]);}
   if(c.downloadMode==='auto'&&l.type==='video'){try{queueDownload(ctx,s,event,l.url,l.meta?.page||1,true);}catch(e){log(ctx,'warn',downloadError(e));}}
   s.stats.success++;record(s,{source:event.message_type,scope,type:d.type,title:d.title,url:d.url,outcome:'success',duration:Date.now()-started});
   for(const key of held)boundedSet(s.seen,key,Date.now()+c.cooldownSeconds*1000);
  }catch(e){
   if(s.closed||s.client!==client)break;
   s.stats.failed++;record(s,{source:event.message_type,scope,type:input.type,title:publicError(e),outcome:'error',duration:Date.now()-started});
   log(ctx,'warn',`解析或发送失败：${input.type} ${input.id}；错误码 ${String(e.code||e.name||'UNKNOWN').slice(0,50)}`);
   if(c.notifyErrors&&(s.errors.get(scope)||0)<Date.now()){
    boundedSet(s.errors,scope,Date.now()+30000);
    try{await send(ctx,event,[{type:'text',data:{text:`【B站识别】${publicError(e)}`}}]);}catch{log(ctx,'warn','失败提示也未能发送，请检查机器人登录状态与发言权限。');}
   }
  }finally{held.forEach(key=>s.locks.delete(key));}
 }}finally{s.active--;}
}

function queueDownload(ctx,s,event,input,page,automatic){
 const scope=`${event.message_type}:${event.message_type==='group'?event.group_id:event.user_id}`;
 const canSend=()=>{
  if(s.closed||!s.config.enabled)return false;
  const current=s.config;const selected=ids(current.groupIds);
  return !(ids(current.blockedUsers).has(String(event.user_id))||(event.message_type==='group'&&(!current.groupEnabled||(current.groupMode==='allow'&&!selected.has(String(event.group_id)))||(current.groupMode==='deny'&&selected.has(String(event.group_id)))))||(event.message_type==='private'&&!current.privateEnabled)||current.downloadMode==='off'||(automatic&&current.downloadMode!=='auto'));
 };
 return s.downloads.enqueue(input,{page,source:event.message_type,scope,automatic,afterError:async(message)=>{if(canSend()&&s.config.notifyErrors)await send(ctx,event,[{type:'text',data:{text:'【B站下载】'+message}}]);},afterDownload:async(file,job,signal)=>{
  signal.throwIfAborted();if(!canSend())throw new BiliError('CANCELLED','当前配置已关闭此会话下载');
  await send(ctx,event,[{type:'video',data:{file}}]);
 }});
}

function makeClient(s){return new BiliClient(s.config,globalThis.fetch,s.gate,{jar:s.session.jar,dm:s.session.dm,onTrace:s.onTrace,onCookies:()=>s.session.save().catch(()=>{throw new BiliError('SESSION_SAVE','会话保存失败');})});}
