import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {scheduleDefaults,scheduleWindows,validateSchedule,liveWindow,detectionReason,detecting} from './live-schedule.mjs';
import {publicError} from './bili.mjs';
import {CardRenderer,liveMessage,liveCardData,collectCardImages,roomUrl,safeImageUrl,renderHint,personas,themes} from './live-card.mjs';

export {liveMessage,personas,themes};

const HOST='https://api.live.bilibili.com';
const fail=message=>Object.assign(new Error(message),{httpStatus:400});
const id=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value);
const clean=(value,max=200)=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max);
function trimRecords(d){let finished=0;d.records=d.records.filter(r=>['queued','attempting'].includes(r.status)||finished++<100);}
const initial=()=>({version:1,revision:0,enabled:false,intervalSeconds:60,...scheduleDefaults,manualTargets:[],subscriptions:[],states:{},rooms:{},manualNotices:{},manualConfig:{avatar:'',cover:'',title:''},records:[]});
function groups(value){
 const list=Array.isArray(value)?value:typeof value==='string'?value.split(/[\s,，;；]+/).filter(Boolean):[];
 if(!list.length||list.length>50||list.some(v=>!id(v)))throw fail('请填写有效的 QQ 群号，最多 50 个。');
 return [...new Set(list)];
}
function flags(b){for(const k of ['enabled','start','end'])if(typeof b[k]!=='boolean')throw fail('订阅开关格式错误。');if(!b.start&&!b.end)throw fail('请至少开启一种通知。');}
export function parseLiveInput(input,type='uid'){
 const value=String(input||'').trim();if(value.length>500)throw fail('输入过长。');
 if(!['uid','room'].includes(type))throw fail('请选择 UID 或直播间号。');
 if(id(value))return {type,id:value};
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)throw 0;
  const match=u.pathname.match(/^\/([1-9]\d{0,15})\/?$/);
  if(match&&['space.bilibili.com','live.bilibili.com'].includes(u.hostname))return {type:u.hostname==='live.bilibili.com'?'room':'uid',id:match[1]};
 }catch{}
 throw fail('请输入 UP 主 UID、直播间号，或完整的 B站个人空间／直播间链接。');
}
export async function fetchLive(client,uid){
 const data=await client.api('/room/v1/Room/get_status_info_by_uids',{'uids[]':uid},HOST);
 const r=data?.[uid];
 if(!r||!id(String(r.room_id))||![0,1,2].includes(r.live_status))throw fail('未取得有效直播状态，请确认该 UP 主已开通直播间。');
 // 封面与头像直接用直播状态接口返回的字段，不额外请求。
 return {uid,roomId:String(r.room_id),name:clean(r.uname,80)||`UID ${uid}`,title:clean(r.title),status:r.live_status,
  startAt:Number.isFinite(Number(r.live_time))&&Number(r.live_time)>0?Number(r.live_time)*1000:0,
  areaName:clean(r.area_v2_name||r.area_name,40),face:safeImageUrl(r.face),cover:safeImageUrl(r.cover_from_user||r.keyframe)};
}

// Configuration writes and notification commits are serialized. Network polls run
// outside this queue so disabling/removing a subscription invalidates in-flight reads.
export class LiveMonitor{
 constructor(dir,getState,send,log=()=>{},options={}){
  this.now=options.now||Date.now;this.manualWorkers=new Map();
  this.file=path.join(dir,'live-subscriptions.json');this.getState=getState;this.send=send;this.log=log;
  this.card=new CardRenderer({dir:path.join(dir,'live-cards'),assetDir:options.assetDir||'',getConfig:()=>this.getState().config||{},getState,log,now:this.now,fs,fetcher:options.fetcher||globalThis.fetch});
  this.data=initial();this.queue=Promise.resolve();this.closed=false;this.running=null;this.timer=null;this.nextCheckAt=0;this.loadError='';this.errors={};
 }
 async init(){
  try{
   const d={...scheduleDefaults,...JSON.parse(await fs.readFile(this.file,'utf8'))};
   Object.assign(d,validateSchedule(d));d.rooms??=structuredClone(d.states||{});d.manualNotices??={};d.manualTargets??=[];
   // 手动通知的素材记忆：只影响手动发送，与在线检测的 states/rooms 完全隔离。
   if(!d.manualConfig||typeof d.manualConfig!=='object'||Array.isArray(d.manualConfig))d.manualConfig={avatar:'',cover:'',title:''};else d.manualConfig={avatar:String(d.manualConfig.avatar||''),cover:String(d.manualConfig.cover||''),title:String(d.manualConfig.title||'')};
   if(!Array.isArray(d.manualTargets)||d.manualTargets.some(x=>!id(x))||!d.rooms||Array.isArray(d.rooms)||typeof d.rooms!=='object'||!d.manualNotices||Array.isArray(d.manualNotices)||typeof d.manualNotices!=='object')throw Error('format');
   if(d.version!==1||typeof d.enabled!=='boolean'||!Number.isInteger(d.revision)||!Number.isInteger(d.intervalSeconds)||d.intervalSeconds<30||d.intervalSeconds>3600||!Array.isArray(d.subscriptions)||d.subscriptions.length>20||!d.states||typeof d.states!=='object'||Array.isArray(d.states)||!Array.isArray(d.records))throw Error('format');
   const unique=new Set();for(const s of d.subscriptions){flags(s);groups(s.groups);if(!id(s.uid)||unique.has(s.uid)||typeof s.label!=='string'||s.label.length>80)throw Error('subscription');unique.add(s.uid);}
   for(const [uid,s] of Object.entries(d.states)){if(!id(uid)||!s||!['live','offline'].includes(s.phase)||!id(s.roomId)||typeof s.name!=='string'||typeof s.title!=='string'||!Number.isFinite(s.startAt))throw Error('state');}
   d.records=d.records.slice(0,100);for(const r of d.records)if(r.status==='queued'||r.status==='attempting'){r.status='uncertain';r.message='插件重载时未取得回执，请先检查群消息，再按需补发。';}this.data=d;
  }catch(e){if(e.code!=='ENOENT'){this.loadError='直播订阅文件读取失败，通知已暂停。请检查或恢复数据目录中的 live-subscriptions.json；原文件未覆盖。';this.log('warn',this.loadError);}}
  await this.card.init().catch(()=>{});
  this.schedule(5000);
 }
 // 组装一条通知：文案 + 可选卡片。渲染失败只记日志并降级，绝不阻断通知。
 async compose(sub,state,kind,now,{titleOverride=''}={}){
  const config=this.getState().config||{};
  // 手动通知可临时覆盖标题：只改本地副本，检测状态里的标题始终是 B站真实值。
  const shownState=titleOverride?{...state,title:titleOverride}:state;
  const card=liveCardData(sub,shownState,kind,now,{persona:config.liveCardPersona,avatarPosition:config.liveCardAvatarPosition});
  const out={text:card.text,reply:card.reply,card:null,hint:'',cardAllowed:!!(config.liveCard&&card.card)};
  if(!out.cardAllowed)return out;
  try{
   const images=await collectCardImages(this.getState().client,{...card,coverSource:state.cover,avatarSource:state.face,cover:'',avatar:''},{stickerDir:this.card.assetDir,fs,decor:config.liveCardDecor});
   const rendered=await this.card.render({...card,cover:images.cover,avatar:images.avatar,qr:images.qr});
   if(rendered.ok){out.card=rendered.file;return out;}
   out.hint=rendered.hint||renderHint(rendered.reason);
   this.log('warn',`直播卡片渲染失败，改用「封面 + 文案」：${out.hint}`);
  }catch(e){
   out.hint='卡片组装失败，本次使用「封面 + 文案」。';
   this.log('warn',`直播卡片组装异常：${String(e?.message||e).slice(0,120)}`);
  }
  return out;
 }
 // 卡片优先；关闭卡片或选用朴素口吻时只发文案；渲染失败退回「封面图 + 文案」。
 async deliver(group,notice){
  const state=notice.state||{};
  const text=notice.reply||notice.text;
  if(notice.card)return this.send(group,[{type:'image',data:{file:notice.card}},{type:'text',data:{text}}]);
  if(!notice.cardAllowed)return this.send(group,notice.text);
  const cover=safeImageUrl(state.cover);
  if(cover)return this.send(group,[{type:'image',data:{file:cover}},{type:'text',data:{text}}]);
  return this.send(group,notice.text);
 }
 snapshot(publicOnly=false){const now=this.now();let data=this.data;
  if(publicOnly){const {rooms,manualNotices,manualTargets,...visible}=data;data={...visible,records:data.records.map(({text,batchId,...r})=>r)};}
  return structuredClone({...data,windows:scheduleWindows(this.data),timezone:'Asia/Shanghai',window:liveWindow(this.data,now),detection:Object.fromEntries(this.data.subscriptions.map(s=>[s.uid,detectionReason(this.data,s,now)])),manualSending:[...this.manualWorkers.keys()],errors:this.errors,running:!!this.running,nextCheckAt:this.nextCheckAt,loadError:this.loadError});}
 transact(fn){const task=this.queue.catch(()=>{}).then(async()=>{
  if(this.closed)throw fail('插件正在关闭。');if(this.loadError)throw fail(this.loadError);
  const next=structuredClone(this.data),result=await fn(next);if(result===false)return false;
  await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';
  await fs.writeFile(temp,JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600});await fs.rename(temp,this.file);this.data=next;return result;
 });this.queue=task;return task;}
 checkRevision(d,revision){if(revision!==d.revision)throw Object.assign(new Error('直播订阅已在其他页面修改，请刷新后重试。'),{httpStatus:409});}
 async settings(b){
  if(typeof b.enabled!=='boolean'||!Number.isInteger(b.intervalSeconds)||b.intervalSeconds<30||b.intervalSeconds>3600)throw fail('检查间隔应为 30–3600 秒。');
  await this.transact(d=>{this.checkRevision(d,b.revision);const patch=Object.fromEntries(['scheduleEnabled','startTime','endTime','windows','continueUntilEnd'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]));if(b.windows===undefined&&(b.startTime!==undefined||b.endTime!==undefined))patch.windows=[{startTime:b.startTime??d.startTime,endTime:b.endTime??d.endTime}];try{const normalized=validateSchedule({...d,...patch});for(const k of ['windows','startTime','endTime'])patch[k]=normalized[k];}catch(e){throw fail(e.message);}
   if(d.enabled!==b.enabled){d.states={};d.manualNotices={};d.manualTargets=[];d.control='auto';}Object.assign(d,patch);d.enabled=b.enabled;d.intervalSeconds=b.intervalSeconds;d.revision++;});
  this.schedule(1000);return this.snapshot();
 }
 async upsert(b){
  flags(b);const targets=groups(b.groups),label=clean(b.label,80),parsed=parseLiveInput(b.input,b.type);
  const client=this.getState().client;let uid=parsed.id;
  try{
   if(parsed.type==='room'){const room=await client.api('/room/v1/Room/room_init',{id:parsed.id},HOST);uid=String(room?.uid);if(!id(uid))throw fail('直播间未返回有效的主播 UID。');}
   const info=await fetchLive(client,uid);
   if(this.closed||this.getState().client!==client)throw fail('账号或插件状态已变化，请重试。');
   await this.transact(d=>{
    this.checkRevision(d,b.revision);const old=d.subscriptions.find(s=>s.uid===uid);
    if(!old&&d.subscriptions.length>=20)throw fail('最多订阅 20 位主播。');
    const sub={uid,label,groups:targets,enabled:b.enabled,start:b.start,end:b.end};d.rooms[uid]=info;
    if(old)d.subscriptions[d.subscriptions.indexOf(old)]=sub;else d.subscriptions.push(sub);
    if(!sub.enabled){d.manualTargets=d.manualTargets.filter(x=>x!==uid);if(d.control==='manual'&&!d.manualTargets.length)d.control='auto';}
    // Saving a new/re-enabled subscription establishes a baseline, never sends a
    // retrospective start notification for a stream that was already in progress.
    if(!old||old.enabled!==sub.enabled)d.states[uid]={...info,phase:info.status===1?'live':'offline',stopHits:0,checkedAt:this.now(),error:''};
    d.revision++;
   });
  }catch(e){if(e.httpStatus)throw e;throw fail(publicError(e));}
  this.schedule(1000);return this.snapshot();
 }
 async remove(b){if(!id(b.uid))throw fail('UID 无效。');await this.transact(d=>{this.checkRevision(d,b.revision);d.subscriptions=d.subscriptions.filter(s=>s.uid!==b.uid);delete d.states[b.uid];delete d.rooms[b.uid];delete d.manualNotices[b.uid];d.manualTargets=d.manualTargets.filter(x=>x!==b.uid);if(d.control==='manual'&&!d.manualTargets.length)d.control='auto';d.revision++;});delete this.errors[b.uid];this.schedule();return this.snapshot();}
 async control(b){
  if(!['start','stop','auto'].includes(b.action))throw fail('检测操作无效。');
  await this.transact(d=>{
   this.checkRevision(d,b.revision);
   if(b.action==='start'&&(!d.enabled||!d.subscriptions.some(s=>s.enabled)))throw fail('请先启用直播检测并添加启用的订阅。');
   d.control={start:'manual',stop:'stopped',auto:'auto'}[b.action];
   d.manualTargets=b.action==='start'?d.subscriptions.filter(s=>s.enabled).map(s=>s.uid):[];d.revision++;
  });
  this.schedule(0);return this.snapshot();
 }
 async manualNotify(b){
  this.log('info',`[LIVE][MANUAL] 收到手动通知请求 UID=${id(b.uid)?b.uid:'无效'} 类型=${['start','end'].includes(b.kind)?b.kind:'无效'}`);
  if(!id(b.uid)||!['start','end'].includes(b.kind))throw fail('主播或通知类型无效。');
  if(this.manualWorkers.has(b.uid))throw Object.assign(new Error('此主播的手动通知正在发送，请等待结果。'),{httpStatus:409});
  // Reserve before awaiting disk writes so two clicks cannot enqueue two batches.
  this.manualWorkers.set(b.uid,null);let batch;
  try{
   await this.transact(d=>{
    this.checkRevision(d,b.revision);const sub=d.subscriptions.find(s=>s.uid===b.uid);
    if(!sub)throw fail('订阅已删除，请刷新。');
    const room=d.rooms[b.uid]||d.states[b.uid];
    if(!room||!id(room.roomId))throw fail('尚无直播间资料，请先验证并保存订阅。');
    let targets=sub.groups,text=liveMessage(sub,room,b.kind,this.now()),card='',reply='',state=room;
    // 手动通知的素材：用户填了就用用户的（允许 data URI 上传）；没填就沿用上次手动的；仍为空则回退缓存的房间资料。
    // 注意：这里只构造发给群里的内容，绝不写回 d.rooms / d.states，检测状态不受影响。
    const remembered=d.manualConfig||{avatar:'',cover:'',title:''};
    const pick=(value,fallback)=>typeof value==='string'?value.trim():fallback;
    const titleOverride=pick(b.title,remembered.title||'').slice(0,60);
    const customAvatar=pick(b.avatar,remembered.avatar||'');
    const customCover=pick(b.cover,remembered.cover||'');
    const shown={...room};
    if(titleOverride)shown.title=titleOverride;
    if(customAvatar)shown.face=customAvatar;
    if(customCover)shown.cover=customCover;
    if(b.recordId!==undefined){
     const r=d.records.find(r=>r.id===b.recordId&&r.uid===b.uid&&r.kind===b.kind);
     if(!r||!['uncertain','cancelled'].includes(r.status)||!sub.groups.includes(r.group))throw fail('该记录不可补发，或原群已从订阅中移除。');
     targets=[r.group];if(r.text)text=r.text;if(r.card)card=r.card;if(r.reply)reply=r.reply;
     // 补发沿用记录里当时的素材；在线检测产生的记录没有素材字段，就回退到缓存房间资料。
     if(r.title)shown.title=r.title;
     if(r.avatar)shown.face=r.avatar;
     if(r.cover)shown.cover=r.cover;
    }else if(b.recordId===undefined){
     d.manualConfig={avatar:customAvatar,cover:customCover,title:titleOverride};
     state=shown;
    }
    const now=this.now(),batchId=randomUUID();
    const rows=targets.map(group=>({id:randomUUID(),batchId,time:now,uid:b.uid,group,kind:b.kind,source:'manual',text,card,reply,
     title:shown.title||'',avatar:shown.face||'',cover:shown.cover||'',status:'queued',message:''}));
    d.records.unshift(...rows);trimRecords(d);
    const pending=d.manualNotices[b.uid]??={},opposite=b.kind==='start'?'end':'start';delete pending[opposite];delete pending[opposite+'At'];
    const phase=d.states[b.uid]?.phase;
    if(phase!==(b.kind==='start'?'live':'offline')){pending[b.kind]=[...new Set([...(pending[b.kind]||[]),...targets])];pending[b.kind+'At']=now;}
    d.revision++;batch={rows,sub:structuredClone(sub),text,reply,card,kind:b.kind,uid:b.uid,state:structuredClone(state),titleOverride,avatarOverride:customAvatar,coverOverride:customCover};
   });
  }catch(e){this.manualWorkers.delete(b.uid);throw e;}
  this.log('info',`[LIVE][MANUAL] 已排队 UID=${b.uid} 类型=${b.kind} 群数=${batch.rows.length}`);
  // 手动通知同样出卡片；渲染失败按记录里的原文案发送，不改变补发内容。
  if(!b.recordId||!batch.card){
   const composed=await this.compose(batch.sub,batch.state||{},b.kind,this.now(),{titleOverride:batch.titleOverride});
   if(composed.card)batch.card=composed.card;
   batch.reply=composed.reply||batch.reply;batch.text=composed.text;batch.cardAllowed=composed.cardAllowed;
  }
  const worker=this.sendManualBatch(batch).catch(()=>{this.log('warn','[LIVE][MANUAL] 手动通知记录保存失败，请检查数据目录权限和群内实际消息。');}).finally(()=>{this.manualWorkers.delete(b.uid);this.schedule();});
  this.manualWorkers.set(b.uid,worker);return this.snapshot();
 }
 async sendManualBatch({rows,sub,card:batchCard='',reply:batchReply='',cardAllowed:batchCardAllowed=false,state:batchState=null}){
  const valid=()=>!this.closed&&JSON.stringify(this.data.subscriptions.find(s=>s.uid===sub.uid))===JSON.stringify(sub);
  for(const row of rows){
   if(this.closed)return;
   const committed=await this.transact(d=>{
    const r=d.records.find(r=>r.id===row.id);if(!r)return false;
    if(!valid()){r.status='cancelled';r.message='订阅已修改或删除，未提交此群消息。';return {send:false};}
    r.status='attempting';return {send:true};
   });
   if(!committed?.send)continue;
   if(this.closed)return;
   if(!valid()){await this.transact(d=>{const r=d.records.find(r=>r.id===row.id);if(r){r.status='cancelled';r.message='订阅已修改或删除，未提交此群消息。';}});continue;}
   let status='sent',message='';
   this.log('info',`[LIVE][MANUAL] 正在发送 UID=${sub.uid} 群=${row.group} 类型=${row.kind}`);
   const cardPath=batchCard||row.card||'';
   try{await this.deliver(row.group,{kind:row.kind,card:cardPath,reply:batchReply||row.reply||'',text:row.text,cardAllowed:batchCardAllowed,state:batchState});this.log('info',`[LIVE][MANUAL] 发送成功 UID=${sub.uid} 群=${row.group} 类型=${row.kind}`);}catch{status='uncertain';message='发送失败或回执超时，请检查群消息后按需补发。';this.log('warn',`[LIVE][MANUAL] 手动直播通知发送异常（UID ${sub.uid}，群 ${row.group}）。`);}
   // 卡片路径在排队后才生成，发送完成时补写进记录，供失败补发复用同一张卡片。
   if(cardPath&&row.card!==cardPath)await this.transact(d=>{const r=d.records.find(r=>r.id===row.id);if(r)r.card=cardPath;}).catch(()=>{});
   if(this.closed)return;
   await this.transact(d=>{const r=d.records.find(r=>r.id===row.id);if(r){r.status=status;r.message=message;}trimRecords(d);});
  }
 }
 schedule(delay=this.data.intervalSeconds*1000){
  clearTimeout(this.timer);this.nextCheckAt=0;
  const d=this.data,now=this.now();
  if(this.closed||this.loadError||!d.enabled||d.control==='stopped'||!d.subscriptions.some(s=>s.enabled))return;
  const active=d.subscriptions.some(s=>detecting(detectionReason(d,s,now)));
  // Outside the window only a local wake-up timer runs; no Bili request is sent.
  const wake=active?now+delay:liveWindow(d,now).nextOpenAt;
  if(!wake)return;
  const cool=this.getState().gate?.snapshot().pausedUntil||0;
  this.nextCheckAt=Math.max(wake,cool);
  this.timer=setTimeout(()=>{this.nextCheckAt=0;void this.check().catch(()=>{});},Math.max(0,this.nextCheckAt-now));this.timer.unref?.();
 }
 check(){
  if(this.running)return this.running;
  if((this.getState().gate?.snapshot().pausedUntil||0)>this.now()){this.schedule();return Promise.resolve();}
  if(this.closed||this.loadError||!this.data.subscriptions.some(s=>detecting(detectionReason(this.data,s,this.now())))){this.schedule();return Promise.resolve();}
  clearTimeout(this.timer);this.nextCheckAt=0;
  this.running=this.poll().catch(e=>{this.log('warn',`直播检查未完成：${e.httpStatus?e.message:'状态保存失败，请检查数据目录权限。'}`);}).finally(()=>{this.running=null;this.schedule();});return this.running;
 }
 async poll(){
  const revision=this.data.revision,client=this.getState().client;
  const valid=()=>!this.closed&&this.data.enabled&&this.data.control!=='stopped'&&this.data.revision===revision&&this.getState().client===client&&!this.getState().closed;
  for(const sub of this.data.subscriptions.filter(s=>s.enabled)){
   if(!valid())return;
   if(!detecting(detectionReason(this.data,sub,this.now()))||this.manualWorkers.has(sub.uid))continue;
   let info;try{info=await fetchLive(client,sub.uid);}catch(e){
    if(!valid())return;
    this.errors[sub.uid]={message:e.httpStatus?e.message:publicError(e),time:this.now()};
    await this.transact(d=>{if(!valid())return false;const old=d.states[sub.uid];if(old){old.error=publicError(e);old.attemptAt=this.now();old.stopHits=0;}});
    this.log('warn',`直播状态检查失败（UID ${sub.uid}）：${publicError(e)}`);
    if(this.getState().gate?.snapshot().pausedUntil>this.now())return;continue;
   }
   if(!valid())return;
   delete this.errors[sub.uid];
   let notice;
   await this.transact(d=>{
    if(!valid())return false;
    const now=this.now(),old=d.states[sub.uid],isLive=info.status===1;
    const next={...info,phase:isLive?'live':'offline',checkedAt:now,attemptAt:now,error:'',stopHits:0};
    let kind='';
    if(old){
     if(isLive){next.startAt=info.startAt||(old.phase==='live'?old.startAt:0)||now;if(old.phase==='offline')kind='start';}
     else if(old.phase==='live'){
      next.stopHits=(old.stopHits||0)+1;next.startAt=old.startAt;next.title=old.title||info.title;
      if(next.stopHits<2)next.phase='live';else kind='end';
     }
    }
    d.states[sub.uid]=next;d.rooms[sub.uid]={...next};
    const suppressed=d.manualNotices[sub.uid]||{};
    // A missed/incorrect manual message must not hide a later day's broadcast.
    for(const k of ['start','end'])if(now-(suppressed[k+'At']||0)>1800000){delete suppressed[k];delete suppressed[k+'At'];}
    const exclude=suppressed[kind]||[];
    // A manual message already covers these recipients for this transition.
    if(isLive){delete suppressed.start;delete suppressed.startAt;}else if(next.phase==='offline'){delete suppressed.end;delete suppressed.endAt;}
    if(kind==='end'){
     d.manualTargets=d.manualTargets.filter(x=>x!==sub.uid);
     if(d.control==='manual'&&!d.manualTargets.length)d.control='auto';
    }
    if(kind&&sub[kind])notice={kind,state:next,time:now,targets:sub.groups.filter(g=>!exclude.includes(g))};
   });
   if(!notice)continue;
   // 一次渲染、多群复用：卡片只渲染一次，避免对每个群重复调用文转图服务。
   const composed=await this.compose(sub,notice.state,notice.kind,notice.time);
   notice.card=composed.card;notice.reply=composed.reply;notice.text=composed.text;notice.cardAllowed=composed.cardAllowed;
   for(const group of notice.targets){
    if(!valid())return;
    // 记录里固化本次用的头像/封面/标题：这是在线检测拿到的真实值，与手动配置无关。
    const row={id:randomUUID(),time:notice.time,uid:sub.uid,group,kind:notice.kind,source:'auto',text:composed.text,card:composed.card||'',reply:composed.reply||'',
     title:notice.state?.title||'',avatar:notice.state?.face||'',cover:notice.state?.cover||'',status:'attempting',message:''};
    // Persist the attempt before submitting to QQ. A timeout may mean QQ already
    // sent the message, so automatic resending would risk duplicate notifications.
    const committed=await this.transact(d=>{if(!valid())return false;d.records.unshift(row);trimRecords(d);return true;});
    if(!committed||!valid())return;
    let status='sent',message='';
    try{await this.deliver(group,notice);}
    catch{status='uncertain';message='发送失败或回执超时，请检查群聊；为避免重复不会自动重发。';this.log('warn',`直播通知发送异常（UID ${sub.uid}，群 ${group}）：${message}`);}
    if(this.closed)return;
    await this.transact(d=>{const r=d.records.find(r=>r.id===row.id);if(r){r.status=status;r.message=message;}trimRecords(d);});
   }
  }
 }
 async close(){this.closed=true;clearTimeout(this.timer);this.nextCheckAt=0;await this.running?.catch(()=>{});await Promise.allSettled([...this.manualWorkers.values()].filter(Boolean));await this.queue.catch(()=>{});}
}
