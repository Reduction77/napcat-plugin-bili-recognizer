import {BiliClient} from './bili.mjs';
import {CookieJar} from './cookies.mjs';
import {BiliError} from './net.mjs';
import {extract} from './parser.mjs';
const API='https://api.bilibili.com';
export class ConnectionCheck {
 constructor(getState,{fetcher=globalThis.fetch}={}){this.getState=getState;this.fetcher=fetcher;this.report=null;this.task=null;this.clients=[];this.closed=false;this.lastStart=0;}
 start(input,mode='session'){
  if(this.closed||this.task)throw new BiliError('CHECK_BUSY','自检正在运行或插件已关闭');if(Date.now()-this.lastStart<60000)throw new BiliError('CHECK_WAIT','两次自检至少间隔 60 秒');
  const link=extract(String(input),true)[0];if(!link||link.type!=='video')throw new BiliError('CHECK_INPUT','请输入完整 BV / AV 号或普通视频链接');if(!['anonymous','session','both'].includes(mode))throw new BiliError('CHECK_INPUT','自检模式无效');
  this.cancelled=false;this.lastStart=Date.now();this.report={version:1,startedAt:Date.now(),status:'running',video:link.id,mode,rows:[],conclusion:'正在顺序测试；不会下载媒体文件或发送 QQ 消息。'};
  this.task=this.run(link,mode).catch(()=>{this.report.status='error';this.report.conclusion='自检被中止；已取得的结果保留。';}).finally(()=>{this.report.finishedAt=Date.now();this.clients.forEach(c=>c.close());this.clients=[];this.task=null;});return this.report;
 }
 async cancel(){this.cancelled=true;this.clients.forEach(c=>c.close());await this.task;}
 async close(){this.closed=true;await this.cancel();}
 async run(link,mode){
  const state=this.getState(),config={...state.config};const modes=mode==='both'?['anonymous','session']:[mode];
  for(const kind of modes){
   let last=null;const jar=kind==='anonymous'?new CookieJar():state.session.jar.clone();const client=new BiliClient({...config,cookie:kind==='anonymous'?'':config.cookie},this.fetcher,state.gate,{jar,dm:state.session.dm,onTrace:r=>{state.onTrace?.(r);if(r.phase!=='REQUEST')last=r;}});this.clients.push(client);
   let bvid=link.id.startsWith('BV')?link.id:null,cid=null;
   const steps=[
    ['主页','/',()=>client.request('https://www.bilibili.com/',{cookie:true,html:true})],
    ['NAV','/x/web-interface/nav',async()=>{const j=await client.request(API+'/x/web-interface/nav',{cookie:true});if(![0,-101].includes(j?.code))client.result(j);return {isLogin:!!j.data?.isLogin};}],
    ['VIEW','/x/web-interface/view',async()=>{const d=await client.api('/x/web-interface/view',bvid?{bvid}:{aid:link.id.slice(2)});bvid=d.bvid;cid=d.pages?.[0]?.cid||d.cid;return {};}],
    ['PLAYER V2','/x/player/wbi/v2',()=>client.signedApi('/x/player/wbi/v2',{bvid,cid})],
    ['PLAYURL',config.playurlMode==='legacy'?'/x/player/playurl':'/x/player/wbi/playurl',()=>client.playInfo(bvid,cid,config.downloadQuality)]
   ];
   for(const [name,endpoint,fn] of steps){
    const row={mode:kind,name,endpoint,httpStatus:null,biliCode:null,status:'pending'};this.report.rows.push(row);
    if(this.closed||this.cancelled){row.status='skipped';row.reason='插件关闭或账号已变化，未请求';continue;}
    if(state.gate.until>Date.now()){row.status='blocked';row.reason='风控冷却，未发起请求';continue;}
    if(name.startsWith('PLAYER')||name==='PLAYURL'){if(!bvid||!cid){row.status='skipped';row.reason='VIEW 未提供有效 BV / CID，未请求';continue;}}
    last=null;
    try{const value=await fn();Object.assign(row,last||{});row.actualEndpoint=last?.endpoint||null;row.endpoint=endpoint;row.status=name==='NAV'&&value.isLogin===false?'anonymous':'ok';if(name==='NAV')row.accountValid=value.isLogin;}
    catch(e){Object.assign(row,e.diagnostic||last||{});row.actualEndpoint=(e.diagnostic||last)?.endpoint||null;row.endpoint=endpoint;row.status=e.code==='BACKOFF'?'blocked':row.httpStatus===412||row.httpStatus===429||[-352,-412].includes(row.biliCode)?'risk':'error';row.reason=e.code==='BACKOFF'?'风控冷却，未请求':row.actualEndpoint&&row.actualEndpoint!==endpoint?'前置接口失败，目标接口未请求':'请求失败，详见 HTTP_STATUS / BILI_CODE';}
   }
  }
  const rows=this.report.rows,risk=rows.filter(r=>r.status==='risk'),network=rows.filter(r=>r.status==='error'&&r.httpStatus==null);
  this.report.status='done';
  if(this.cancelled){this.report.status='cancelled';this.report.conclusion='自检已取消；保留已取得结果，未完成接口不能判定。';}
  else if(risk.length){const r=risk[0];this.report.conclusion=`已定位本次自检风险响应：${r.actualEndpoint||r.endpoint}，HTTP_STATUS=${r.httpStatus??'null'}，BILI_CODE=${r.biliCode??'null'}。后续未请求的接口不能据此判定被封锁；尚不能排除账号、出口网络或客户端请求差异。`;}
  else if(network.length)this.report.conclusion='未取得部分接口的 HTTP 响应，属于网络/连接或前置签名材料问题，不能认定为 B站 412。';
  else if(rows.some(r=>['blocked','skipped'].includes(r.status)))this.report.conclusion='自检结果不完整。冷却或前置条件导致部分接口未请求，不能判断 412 是否已解决。';
  else if(rows.some(r=>r.status==='error'))this.report.conclusion='本轮存在接口错误，但没有记录到 412；请按具体 HTTP_STATUS / BILI_CODE 排查。';
  else this.report.conclusion='本轮所测接口没有出现 412；这只代表当前视频和本次环境，不能保证其他视频或后续请求不受限。';
 }
}
