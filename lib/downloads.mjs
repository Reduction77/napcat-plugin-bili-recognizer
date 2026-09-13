import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {BiliError,UA} from './net.mjs';
import {requestMeta,emitTrace} from './trace.mjs';
import {extract} from './parser.mjs';
import {errorSummary,retryableMediaError,detailedDownloadError} from './download-errors.mjs';
import {mediaUrl,inspectMediaUrl,streamSource} from './media-url.mjs';
export {mediaUrl} from './media-url.mjs';
const UUID=/^[a-f0-9-]{36}$/;
export const qualityName=q=>({16:'360P',32:'480P',64:'720P',80:'1080P'}[q]||String(q));
export function downloadError(e){const map={QUALITY:'接口返回的视频清晰度超过设置上限，已停止下载。',LIMIT:'视频超过配置的大小或时长上限。',CACHE_FULL:'下载缓存空间不足，请先清理缓存或调高容量。',TYPE:'只支持普通 BV / AV 视频下载。',PAGE:'该视频没有所选分 P。',STREAM:'没有获取到可下载的视频流。',CODEC:'没有找到适合 QQ 播放的 H.264 / AAC 视频流。',RESTRICTED:'此内容需要额外权限或受播放限制，无法下载。',FFMPEG_MISSING:'此视频需要 FFmpeg，请在服务器安装 FFmpeg ；如需单文件模式，可将清晰度设为 360P。',FFMPEG:'音视频合并失败，请检查 FFmpeg 与视频流格式。',MEDIA_URL:'视频流地址不受支持，请在「视频下载」任务旁打开「错误详情」。',QUEUE:'下载队列已满，请稍后再试。',CANCELLED:'下载已取消。',BACKOFF:'B站请求正在冷却，稍后再下载。'};return map[e?.code]||detailedDownloadError(e);}
export async function runFFmpeg(executable,args,signal){
 signal?.throwIfAborted();await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','ignore']});
  const abort=()=>child.kill('SIGKILL');signal?.addEventListener('abort',abort,{once:true});
  child.on('error',e=>{signal?.removeEventListener('abort',abort);reject(new BiliError(e.code==='ENOENT'?'FFMPEG_MISSING':'FFMPEG','FFmpeg 无法运行'));});
  child.on('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)reject(signal.reason);else if(code===0)resolve();else reject(new BiliError('FFMPEG','FFmpeg 返回错误'));});
 });
}
export async function ffmpegStatus(executable){try{await runFFmpeg(executable,['-version'],AbortSignal.timeout(5000));return {available:true};}catch{return {available:false};}}
export function selectStreams(d,quality){
 if(d.is_drm||d.is_preview)throw new BiliError('RESTRICTED','受限视频');
 const videos=(d.dash?.video||[]).filter(x=>Number(x.id)<=quality&&(Number(x.codecid)===7||/^avc1/i.test(x.codecs||''))).sort((a,b)=>b.id-a.id);
 const audio=(d.dash?.audio||[]).filter(x=>!x.codecs||/^mp4a/i.test(x.codecs)).sort((a,b)=>(b.bandwidth||0)-(a.bandwidth||0));
 // DASH lists all available qualities: select by the video track id, not d.quality.
 if(videos.length&&audio.length)return {kind:'dash',quality:Number(videos[0].id),streams:[videos[0],audio[0]].map(x=>streamSource(x))};
 if(Array.isArray(d.durl)&&d.durl.length){const actual=Number(d.quality)||null;if(actual>quality)throw new BiliError('QUALITY','接口返回清晰度超过设置上限');return {kind:'progressive',quality:actual,streams:d.durl.map(x=>streamSource(x,Number(x.size)||0))};}
 throw new BiliError('CODEC','未找到所选上限内的 H.264/AAC 流');
}

const publicJob=({id,title,page,status,createdAt,finishedAt,bytes,quality,error,sendError,fileReady,stage,downloaded,total,source,failure,requestedQuality,qualityNotice})=>({id,title,page,status,createdAt,finishedAt,bytes,quality,error,sendError,fileReady:!!fileReady,stage,downloaded,total,source,failure,requestedQuality,qualityNotice});

export class DownloadManager {
 constructor(root,getState,log,options={}){this.root=root;this.getState=getState;this.log=log;this.fetcher=options.fetcher||globalThis.fetch;this.run=options.runFFmpeg||runFFmpeg;this.wait=options.wait||((ms,signal)=>delay(ms,undefined,{signal}));this.jobs=[];this.queue=[];this.active=null;this.worker=null;this.closed=false;this.readers=new Map();this.ffmpeg=null;this.pruning=false;}
 async init(){
  await fs.mkdir(this.root,{recursive:true,mode:0o700});
  for(const name of await fs.readdir(this.root)){if(!UUID.test(name))continue;const dir=path.join(this.root,name);try{if(!(await fs.lstat(dir)).isDirectory())continue;const data=JSON.parse(await fs.readFile(path.join(dir,'task.json'),'utf8'));if(data.kind!=='bili-download-v1')continue;
   if(data.status==='done'&&(await fs.stat(path.join(dir,'video.mp4'))).isFile()){this.jobs.push({...data,id:name,readers:0,fileReady:true});}else await fs.rm(dir,{recursive:true,force:true});
  }catch{/* Unrecognized directories are left alone. */}}
  this.jobs.sort((a,b)=>b.createdAt-a.createdAt);await this.prune();
  this.timer=setInterval(()=>this.prune().catch(()=>{}),600000);this.timer.unref?.();
 }
 list(){return this.jobs.map(publicJob);}
 async engine(refresh=false){const executable=this.getState().config.ffmpegPath;if(refresh||!this.ffmpeg||this.ffmpeg.executable!==executable)this.ffmpeg={executable,...await ffmpegStatus(executable)};return {available:this.ffmpeg.available};}
 enqueue(input,{page=1,source='webui',afterDownload=null,afterError=null,scope='',automatic=false}={}){
  if(this.closed)throw new BiliError('CANCELLED','下载器已停止');if(!Number.isInteger(page)||page<1||page>1000)throw new BiliError('PAGE','分P无效');
  const link=extract(String(input),true)[0];if(!link||!['video','short'].includes(link.type))throw new BiliError('TYPE','只支持视频链接');
  if(this.queue.length+(this.active?1:0)>=3)throw new BiliError('QUEUE','队列已满');
  if(this.jobs.some(j=>['queued','downloading','sending'].includes(j.status)&&j.inputKey===link.key&&j.page===page&&j.scope===scope))throw new BiliError('QUEUE','同一视频已有下载任务');
  const job={id:randomUUID(),title:link.type==='short'?'正在解析短链':link.id,page,status:'queued',createdAt:Date.now(),downloaded:0,total:0,source,scope,automatic,inputKey:link.key,link,afterDownload,afterError,controller:new AbortController(),fileReady:false};
  this.jobs.unshift(job);this.queue.push(job);this.kick();return {id:job.id,status:job.status};
 }
 kick(){if(this.worker||this.closed)return;this.worker=this.drain().finally(()=>{this.worker=null;if(this.queue.length&&!this.closed)this.kick();});}
 async drain(){while(this.queue.length&&!this.closed){const j=this.queue.shift();if(j.status!=='queued')continue;this.active=j;await this.execute(j);this.active=null;}}
 async save(job){await fs.writeFile(path.join(this.root,job.id,'task.json'),JSON.stringify({kind:'bili-download-v1',...publicJob(job)}),{mode:0o600});}
 async execute(job){
  const state=this.getState(),c={...state.config},client=state.client;
  const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(c.downloadTimeoutSeconds*1000)]);
  const dir=path.join(this.root,job.id);let completed=false;
  try{
   job.status='downloading';job.stage='获取视频信息';await fs.mkdir(dir,{recursive:true,mode:0o700});await this.save(job);
   const link=await client.resolve(job.link);signal.throwIfAborted();if(link.type!=='video')throw new BiliError('TYPE','短链不是普通视频');
   const info=await client.info(link),meta=info.videoMeta;if(!meta)throw new BiliError('STREAM','缺少视频信息');
   job.bvid=meta.bvid;job.title=info.title;const pages=meta.pages.length?meta.pages:[{cid:meta.cid,duration:meta.duration}];const selected=pages[job.page-1];if(!selected?.cid)throw new BiliError('PAGE','分P不存在');
   if(Number(selected.duration||meta.duration)>c.downloadMaxSeconds)throw new BiliError('LIMIT','视频过长');
   if(pages.length>1)job.title+=` · P${job.page} ${selected.part||''}`;
   if(meta.rights?.pay||meta.rights?.arc_pay)throw new BiliError('RESTRICTED','付费视频');
   job.requestedQuality=c.downloadQuality;
   const d=await client.playInfo(meta.bvid,selected.cid,c.downloadQuality);signal.throwIfAborted();
   const plan=selectStreams(d,c.downloadQuality);job.quality=plan.quality;
   job.qualityNotice=!plan.quality?'接口未标明实际清晰度。':plan.quality<c.downloadQuality?`目标 ${qualityName(c.downloadQuality)}；本次响应可用的兼容视频流最高为 ${qualityName(plan.quality)}。`:'';
   this.log('info',`[QUALITY] requested=${qualityName(c.downloadQuality)} actual=${plan.quality?qualityName(plan.quality):'unknown'} format=${plan.kind}`);if(job.qualityNotice)this.log('warn',job.qualityNotice);
   if((plan.kind==='dash'||plan.streams.length>1)&&!(await this.engine()).available)throw new BiliError('FFMPEG_MISSING','合并视频需要 FFmpeg');
   job.total=plan.streams.reduce((n,s)=>n+s.size,0);const limit=c.downloadMaxMB*1024*1024;if(job.total>limit)throw new BiliError('LIMIT','视频过大');
   await this.prune(limit);signal.throwIfAborted();
   const files=[];for(let i=0;i<plan.streams.length;i++){
    job.stage=plan.kind==='dash'?(i===0?'下载画面':'下载音轨'):`下载视频 ${i+1}/${plan.streams.length}`;
    const file=path.join(dir,`part-${i}.bin`);await this.downloadStream(plan.streams[i],file,job,limit,signal);files.push(file);
   }
   const output=path.join(dir,'video.mp4');let direct=false;
   if(plan.kind==='progressive'&&files.length===1){const handle=await fs.open(files[0]);const buf=Buffer.alloc(12);try{await handle.read(buf,0,12,0);direct=buf.toString('ascii',4,8)==='ftyp';}finally{await handle.close();}}
   if(direct)await fs.rename(files[0],output);
   else{
    job.stage='合并音视频';const args=['-hide_banner','-loglevel','error','-nostdin','-y'];
    if(plan.kind==='dash')args.push('-protocol_whitelist','file,pipe','-i',files[0],'-protocol_whitelist','file,pipe','-i',files[1],'-map','0:v:0','-map','1:a:0');
    else if(files.length>1){const list=path.join(dir,'concat.txt');await fs.writeFile(list,files.map((_,i)=>`file 'part-${i}.bin'`).join('\n'));args.push('-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',list);}
    else args.push('-protocol_whitelist','file,pipe','-i',files[0]);
    args.push('-c','copy','-movflags','+faststart',output);await this.run(c.ffmpegPath,args,signal);
   }
   signal.throwIfAborted();const stat=await fs.stat(output);if(!stat.size||stat.size>limit)throw new BiliError('LIMIT','输出文件大小无效');
   // Budget reservation accounts for inputs plus the remux output.
   for(const file of await fs.readdir(dir))if(file!=='video.mp4'&&file!=='task.json')await fs.rm(path.join(dir,file),{force:true});
   job.bytes=stat.size;job.downloaded=stat.size;job.fileReady=true;job.finishedAt=Date.now();completed=true;
   if(job.afterDownload&&!this.closed&&!job.controller.signal.aborted){job.status='sending';job.stage='正在发送 QQ';try{await job.afterDownload(pathToFileURL(output).href,job,signal);}catch(e){job.sendError='视频已下载，但 QQ 发送失败；可在下载页面保存文件。';this.log('warn',job.sendError);}}
   job.status='done';job.stage='完成';await this.save(job);this.log('info',`视频下载完成：P${job.page}，${qualityName(job.quality)}，${(job.bytes/1048576).toFixed(1)} MB`);
  }catch(e){if(e.mediaCandidates)emitTrace(state.onTrace,{...requestMeta('https://api.bilibili.com/',{media:true}),host:null,endpoint:'[video CDN validation]',phase:'ERROR',bvid:job.bvid||null,jobId:job.id,error:'MEDIA_URL',mediaCandidates:e.mediaCandidates});job.failure={...(e.downloadDiagnostic||{...errorSummary(e),stage:'processing'}),taskStage:job.stage};if(!e.downloadDiagnostic)emitTrace(state.onTrace,{...requestMeta('https://api.bilibili.com/',{media:true}),host:null,endpoint:'[download processing]',phase:'ERROR',bvid:job.bvid||null,jobId:job.id,error:'DOWNLOAD_FAILED',downloadFailure:job.failure});job.status=job.controller.signal.aborted||this.closed?'cancelled':'error';job.error=downloadError(e);job.stage='已停止';job.finishedAt=Date.now();this.log('warn',job.error);if(job.status==='error'&&job.afterError&&!this.closed){try{await job.afterError(job.error);}catch{}}}
  finally{
   job.afterDownload=null;job.afterError=null;job.link=null;
   if(!completed){job.fileReady=false;await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
   // Keep finished error records bounded while retaining every managed file.
   const extras=this.jobs.filter(j=>!j.fileReady&&!['queued','downloading','sending'].includes(j.status));for(const old of extras.slice(50))this.jobs=this.jobs.filter(j=>j!==old);
  }
 }
 async downloadStream(stream,file,job,limit,signal){
  const urls=[...new Set(stream.urls||[stream.url])].slice(0,3),baseBytes=job.downloaded,stage=job.stage;
  // Like the reference parser, retry transient failures even when Bili returns
  // only one URL. Try available backups first, then revisit each URL twice.
  // All rounds share the original task deadline, cancellation and rate gate.
  for(let attempt=0;attempt<urls.length*3;attempt++){
   signal.throwIfAborted();const index=attempt%urls.length,round=Math.floor(attempt/urls.length);
   job.stage=attempt?`${stage} · 第 ${attempt+1} 次请求（地址 ${index+1}/${urls.length}）`:stage;
   try{return await this.download(urls[index],file,job,limit,signal,attempt+1,{addressCount:urls.length,addressIndex:index+1,addressAttempt:round+1});}
   catch(e){
    if(signal.aborted||!retryableMediaError(e)||attempt===urls.length*3-1)throw e;
    // Restart this track from byte zero. Never append a backup to a partial file.
    await fs.rm(file,{force:true});job.downloaded=baseBytes;
    const nextIndex=(attempt+1)%urls.length,nextRound=Math.floor((attempt+1)/urls.length),waitMs=Math.max(1,nextRound)*1000;
    job.stage=`${stage} · ${waitMs/1000} 秒后${nextIndex===index?'重试当前地址':'尝试备用地址'}`;
    this.log('warn',`视频传输中断（${e.downloadDiagnostic.causeCode||e.downloadDiagnostic.code||e.downloadDiagnostic.name}），${waitMs/1000} 秒后进行第 ${attempt+2} 次请求，地址 ${nextIndex+1}/${urls.length}，该地址第 ${nextRound+1}/3 次尝试。`);
    await this.wait(waitMs,signal);
   }
  }
  throw new BiliError('MEDIA_URL','没有可用的视频流地址');
 }
 async download(url,file,job,limit,signal,attempt=1,attemptInfo={}){
  let next=mediaUrl(url),r,trace,reader,handle,stage='connect',failed=false;
  const started=Date.now(),before=job.downloaded;
  try{
   for(let hop=0;hop<5;hop++){
    if(!next)throw new BiliError('MEDIA_URL','不支持的媒体地址');signal.throwIfAborted();
    await this.getState().gate?.enter(signal);
    const referer='https://www.bilibili.com/';
    trace={...requestMeta(next,{referer,media:true}),bvid:job.bvid||null,jobId:job.id,attempt,retryCount:attempt-1};emitTrace(this.getState().onTrace,{...trace,phase:'REQUEST'});
    stage='connect';r=await this.fetcher(next,{redirect:'manual',headers:{'User-Agent':UA,Referer:referer,Origin:'https://www.bilibili.com',Accept:'*/*','Accept-Encoding':'identity'},signal});trace.httpStatus=r.status;
    emitTrace(this.getState().onTrace,{...trace,phase:[412,429].includes(r.status)?'RISK':'RESPONSE',durationMs:Date.now()-started});stage='response';
    this.getState().gate?.hit(r.status,r.headers.get('retry-after'));
    if(r.status>=300&&r.status<400){const location=r.headers.get('location');await r.body?.cancel();let target;try{target=location?new URL(location,next).href:undefined;}catch{target=undefined;}const checked=inspectMediaUrl(target);if(!checked.url){const e=new BiliError('MEDIA_URL','媒体跳转地址不受支持');const {host,port,protocol,reason}=checked;e.mediaCandidates=[{host,port,protocol,reason}];throw e;}next=checked.url;r=null;continue;}break;
   }
   if(!r)throw new BiliError('MEDIA_URL','媒体跳转过多');
   if(!r.ok)throw new BiliError(r.status,'媒体下载失败');
   const size=Number(r.headers.get('content-length'))||0;if(job.downloaded+size>limit)throw new BiliError('LIMIT','视频流过大');
   stage='read_body';reader=r.body?.getReader();if(!reader)throw new BiliError('STREAM','视频流为空');
   stage='file_open';handle=await fs.open(file,'wx',0o600);
   while(true){
    signal.throwIfAborted();stage='read_body';const {done,value}=await reader.read();if(done)break;
    if(job.downloaded+value.length>limit)throw new BiliError('LIMIT','视频超过大小限制');
    stage='file_write';let offset=0;while(offset<value.length){const {bytesWritten}=await handle.write(value,offset,value.length-offset);if(!bytesWritten){const e=new Error('zero-byte write');e.code='EIO';throw e;}offset+=bytesWritten;job.downloaded+=bytesWritten;}
   }
   const encoding=r.headers.get('content-encoding');
   if(job.downloaded===before)throw new BiliError('STREAM','视频流为空');
   if(size&&(!encoding||encoding==='identity')&&job.downloaded-before!==size)throw new BiliError('MEDIA_TRUNCATED','响应体长度不完整');
   stage='file_close';await handle.close();handle=null;
   emitTrace(this.getState().onTrace,{...trace,phase:'COMPLETE',durationMs:Date.now()-started,receivedBytes:job.downloaded-before});
  }catch(e){
   failed=true;e.downloadDiagnostic={...errorSummary(e),stage,attempt,...attemptInfo,host:trace?.host||null,httpStatus:trace?.httpStatus??null,receivedBytes:job.downloaded-before};
   emitTrace(this.getState().onTrace,{...(trace||requestMeta('https://api.bilibili.com/',{media:true})),phase:'ERROR',error:'MEDIA_TRANSFER_FAILED',durationMs:Date.now()-started,downloadFailure:e.downloadDiagnostic});throw e;
  }finally{
   if(reader)await reader.cancel().catch(()=>{});else if(r?.body)await r.body.cancel().catch(()=>{});
   if(handle)await handle.close().catch(e=>{if(!failed)throw e;});
  }
 }

 cancel(id){const j=this.jobs.find(x=>x.id===id);if(!j||!['queued','downloading'].includes(j.status))throw new BiliError('CANCELLED','任务不能取消');j.controller.abort(new BiliError('CANCELLED','用户取消'));if(j.status==='queued'){j.status='cancelled';j.stage='已取消';j.error='下载已取消。';this.queue=this.queue.filter(x=>x!==j);}return {cancelled:true};}
 cancelAll(){for(const j of this.jobs)if(['queued','downloading'].includes(j.status))this.cancel(j.id);}
 async close(){this.closed=true;clearInterval(this.timer);this.cancelAll();await this.worker;}
 async prune(reserve=0){
  if(this.pruning){if(reserve)throw new BiliError('CACHE_FULL','缓存清理中');return;}this.pruning=true;
  try{const c=this.getState().config;const completed=this.jobs.filter(j=>j.fileReady&&j.status==='done').sort((a,b)=>a.createdAt-b.createdAt);let bytes=completed.reduce((n,j)=>n+(j.bytes||0),0);const max=c.downloadCacheMB*1048576;
   for(const j of completed){if((this.readers.get(j.id)||0)>0)continue;if(j.finishedAt+c.downloadKeepHours*3600000<Date.now()||bytes+reserve*2>max){await fs.rm(path.join(this.root,j.id),{recursive:true,force:true});j.fileReady=false;j.status='expired';bytes-=j.bytes||0;}}
   if(reserve&&bytes+reserve*2>max)throw new BiliError('CACHE_FULL','缓存空间不足');
  }finally{this.pruning=false;}
 }
 async clear(){if(this.active||this.queue.length||[...this.readers.values()].some(Boolean))throw new BiliError('QUEUE','仍有任务或文件传输');for(const j of this.jobs)if(j.fileReady){await fs.rm(path.join(this.root,j.id),{recursive:true,force:true});j.fileReady=false;j.status='expired';}return {cleared:true};}
 async file(id){const job=this.jobs.find(x=>x.id===id);if(!job?.fileReady||job.status!=='done'||!UUID.test(id))throw new BiliError('FILE','文件不存在或已过期');const file=path.join(this.root,id,'video.mp4');await fs.stat(file);this.readers.set(id,(this.readers.get(id)||0)+1);let released=false;return {path:file,name:`bilibili-${id.slice(0,8)}-P${job.page}.mp4`,release:()=>{if(!released){released=true;this.readers.set(id,Math.max(0,(this.readers.get(id)||1)-1));}}};}
}
