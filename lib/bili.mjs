import {safeBiliUrl,parseUrl,labels} from './parser.mjs';
import {UA,BiliError,readJson} from './net.mjs';
import {REQUEST_META,requestMeta,numericCode,emitTrace} from './trace.mjs';
import {CookieJar} from './cookies.mjs';
import {mixinKey,signWbi,makeDm,validDm} from './wbi.mjs';
export {BiliError} from './net.mjs';
const API='https://api.bilibili.com';
export function publicError(e) {
 if(e?.code==='BACKOFF')return 'B站请求正在冷却，请在控制台查看剩余时间；冷却期间不会重复请求。';
 if(e?.name==='AbortError'||e?.name==='TimeoutError')return '请求超时，请稍后再试。';
 if(['-101','-111'].includes(String(e?.code)))return '该内容需要有效的 B站登录状态，请管理员检查插件 Cookie。';
 if(['-352','-412','403','412','429'].includes(String(e?.code)))return 'B站暂时限制了请求，请稍后再试。';
 if(['-404','404','62002'].includes(String(e?.code)))return '内容不存在、已删除或暂不可见。';
 return '暂时无法获取内容，请稍后再试；管理员可查看 NapCat 日志。';
}
export const safeImage=value=>{try{const u=new URL(String(value).replace(/^http:/,'https:').replace(/^\/\//,'https://'));return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='hdslb.com'||u.hostname.endsWith('.hdslb.com'))?u.href:null;}catch{return null;}};
export class BiliClient {
 constructor(config,fetcher=globalThis.fetch,gate=null,options={}){this.options=options;this.jar=options.jar||new CookieJar();if(!options.jar)this.jar.importLegacy(config.cookie);this.dm=validDm(options.dm)?options.dm:makeDm();this.wbi=null;this.wbiPending=null;this.apiPending=new Map();this.shortCache=new Map();this.shortPending=new Map();this.playCache=new Map();this.playPending=new Map();this.gate=gate;this.config=config;this.fetcher=fetcher;this.abort=new AbortController();this.cache=new Map();this.pending=new Map();}
 close(){this.abort.abort();this.cache.clear();this.pending.clear();this.apiPending.clear();this.shortCache.clear();this.shortPending.clear();this.playCache.clear();this.playPending.clear();}
 async request(url,{method='GET',cookie=false,redirect=false,html=false,referer='https://www.bilibili.com/'}={}) {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||u.port)throw new BiliError('HOST','无效接口地址');
  if(cookie&&!['api.bilibili.com','api.live.bilibili.com','www.bilibili.com'].includes(u.hostname))throw new BiliError('HOST','无效接口域名');
  if(!cookie&&!safeBiliUrl(url))throw new BiliError('HOST','无效跳转域名');
  const credential=cookie?this.jar.header(url):'';
  const trace=requestMeta(url,{method,cookie:credential,referer});let started=Date.now(),sent=false;
  const emit=phase=>emitTrace(this.options.onTrace,{...trace,phase,durationMs:Date.now()-started});
  try{
   await this.gate?.enter(this.abort.signal);this.abort.signal.throwIfAborted();started=Date.now();sent=true;emit('REQUEST');
   const r=await this.fetcher(url,{method,redirect:'manual',headers:{'User-Agent':UA,Referer:referer,Accept:html?'text/html,application/xhtml+xml':'application/json, text/plain, */*','Accept-Language':'zh-CN,zh;q=0.9',...(credential?{Cookie:credential}:{})},signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(this.config.timeoutSeconds*1000)])});
   this.abort.signal.throwIfAborted();trace.httpStatus=r.status;this.gate?.hit(r.status,r.headers.get('retry-after'));if(cookie){this.jar.ingest(r.headers,url);await this.options.onCookies?.();}
   if(redirect){await r.body?.cancel();emit([412,429].includes(r.status)?'RISK':'RESPONSE');return r;}
   if(!r.ok){await r.body?.cancel();throw new BiliError(String(r.status),`HTTP ${r.status}`);}
   if(html){await r.body?.cancel();emit('RESPONSE');return {httpStatus:r.status};}
   const j=await readJson(r);if(u.pathname==='/x/web-interface/nav')this.observeNav(j);trace.biliCode=numericCode(j?.code);this.gate?.hit(trace.biliCode);
   if(j&&typeof j==='object')Object.defineProperty(j,REQUEST_META,{value:{...trace,durationMs:Date.now()-started}});
   emit([-352,-412].includes(trace.biliCode)?'RISK':'RESPONSE');return j;
  }catch(e){trace.error=e.code==='BACKOFF'?'BACKOFF':sent?(e.name==='TimeoutError'?'TIMEOUT':e.name==='AbortError'?'ABORTED':'REQUEST_FAILED'):'NOT_SENT';
   e.diagnostic={...trace,durationMs:Date.now()-started};emit([412,429].includes(trace.httpStatus)?'RISK':sent?'ERROR':'BLOCKED');throw e;
  }
 }
 result(j){if(j?.code!==0){const e=new BiliError(String(numericCode(j?.code)??'FORMAT'),'B站接口返回错误');e.diagnostic=j?.[REQUEST_META];throw e;}const d=j.data??j.result;if(d==null)throw new BiliError('FORMAT','接口缺少 data/result');return d;}
 async api(endpoint,params={},host=API){const u=new URL(endpoint,host);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));const key=u.href;if(this.apiPending.has(key))return this.apiPending.get(key);const task=this.request(u.href,{cookie:true,referer:this.referer(params.bvid)}).then(j=>this.result(j)).finally(()=>this.apiPending.delete(key));this.apiPending.set(key,task);return task;}
 referer(bvid){return /^BV[a-zA-Z0-9]{10}$/.test(bvid||'')?`https://www.bilibili.com/video/${bvid}/`:'https://www.bilibili.com/';}
 observeNav(j){try{const img=j?.data?.wbi_img;if(img)this.wbi={key:mixinKey(img.img_url,img.sub_url),until:Date.now()+30000};}catch{this.wbi=null;}}
 async wbiKey(){if(this.wbi?.until>Date.now())return this.wbi.key;if(this.wbiPending)return this.wbiPending;this.wbiPending=(async()=>{const j=await this.request(API+'/x/web-interface/nav',{cookie:true});if(![0,-101].includes(j?.code))this.result(j);if(!this.wbi)throw new BiliError('WBI_KEY','NAV 未返回 WBI 签名材料');return this.wbi.key;})().finally(()=>this.wbiPending=null);return this.wbiPending;}
 async signedApi(endpoint,params){const key=await this.wbiKey();this.abort.signal.throwIfAborted();const signed=signWbi(params,key);return this.result(await this.request(API+endpoint+'?'+signed.query,{cookie:true,referer:this.referer(params.bvid)}));}
 async playInfo(bvid,cid,quality=this.config.downloadQuality){
  const cacheKey=`${bvid}:${cid}:${quality}:${this.config.playurlMode||'wbi'}`;const hit=this.playCache.get(cacheKey);if(hit?.until>Date.now())return hit.value;if(this.playPending.has(cacheKey))return this.playPending.get(cacheKey);
  const task=(async()=>{const params={bvid,cid,qn:quality,fnval:quality<=16?1:4048,fnver:0,fourk:0};const value=this.config.playurlMode==='legacy'?await this.api('/x/player/playurl',params):await this.signedApi('/x/player/wbi/playurl',{...this.dm,...params});this.playCache.set(cacheKey,{value,until:Date.now()+30000});while(this.playCache.size>20)this.playCache.delete(this.playCache.keys().next().value);return value;})().finally(()=>this.playPending.delete(cacheKey));this.playPending.set(cacheKey,task);return task;
 }
 async resolve(link){if(link.type!=='short')return link;const hit=this.shortCache.get(link.key);if(hit?.until>Date.now())return hit.value;if(this.shortPending.has(link.key))return this.shortPending.get(link.key);const task=this.resolveShort(link).then(value=>{this.shortCache.set(link.key,{value,until:Date.now()+600000});while(this.shortCache.size>200)this.shortCache.delete(this.shortCache.keys().next().value);return value;}).finally(()=>this.shortPending.delete(link.key));this.shortPending.set(link.key,task);return task;}
 async resolveShort(link){
  if(link.type!=='short')return link;
  let url=link.url;
  for(let i=0;i<5;i++){
   const r=await this.request(url,{redirect:true});
   if(r.status>=300&&r.status<400&&r.headers.get('location')){
    const u=safeBiliUrl(new URL(r.headers.get('location'),url).href);if(!u)throw new BiliError('REDIRECT','短链指向非 B站地址');
    const parsed=parseUrl(u.href);if(parsed&&parsed.type!=='short')return parsed;
    if(!u.hostname.endsWith('b23.tv'))throw new BiliError('UNSUPPORTED','短链内容无法识别');url=u.href;
   }else throw new BiliError(String(r.status),'短链未返回可识别跳转');
  }
  throw new BiliError('REDIRECT','短链跳转次数过多');
 }
 async info(link){
  const hit=this.cache.get(link.key);if(hit&&hit.until>Date.now())return hit.value;
  if(this.pending.has(link.key))return this.pending.get(link.key);
  const task=this.fetchInfo(link).then(value=>{this.cache.set(link.key,{value,until:Date.now()+60000});while(this.cache.size>200)this.cache.delete(this.cache.keys().next().value);return value;}).finally(()=>this.pending.delete(link.key));this.pending.set(link.key,task);return task;
 }
 async fetchInfo(l){
  const {type:t,id,meta={}}=l;
  const base={type:t,url:l.url,title:labels[t],description:'',stats:[],images:[],key:l.key};
  const finish=(d)=>({...base,...d,images:(d.images||[]).map(safeImage).filter(Boolean).slice(0,1)});
  if(t==='video'){
   const d=await this.api('/x/web-interface/view',id.startsWith('BV')?{bvid:id}:{aid:id.slice(2)});
   if(!d.title)throw new BiliError('FORMAT','视频信息缺少标题');
   const s=d.stat||{};return finish({key:`video:${d.bvid||id}`,title:d.title,videoMeta:{bvid:d.bvid||id,cid:d.cid,duration:d.duration,pages:d.pages||[],rights:d.rights||{}},author:d.owner?.name,description:d.desc,images:[d.pic],details:[`时长 ${duration(d.duration)}`,d.videos>1?`共 ${d.videos} P`:null],stats:[['播放',s.view],['点赞',s.like],['投币',s.coin],['收藏',s.favorite]],url:`https://www.bilibili.com/video/${d.bvid||id}`});
  }
  if(['bangumi','ep','media'].includes(t)){
   let sid=id;if(t==='media'){const m=await this.api('/pgc/review/user',{media_id:id});sid=m.media?.season_id;if(!sid)throw new BiliError('FORMAT','未获取到番剧编号');}
   const d=await this.api('/pgc/view/web/season',t==='ep'?{ep_id:id}:{season_id:sid});
   const ep=t==='ep'?d.episodes?.find(x=>String(x.id)===id):null;
   return finish({title:d.title+(ep?` · ${ep.long_title||ep.title}`:''),description:d.evaluate,images:[ep?.cover||d.cover],details:[d.new_ep?.desc,d.rating?.score?`评分 ${d.rating.score}`:null],stats:[['播放',d.stat?.views],['追番',d.stat?.favorites]]});
  }
  if(t==='dynamic'||t==='opus'){
   const d=(await this.api('/x/polymer/web-dynamic/v1/detail',{id})).item;if(!d?.modules)throw new BiliError('FORMAT','动态信息缺失');
   const m=d.modules,dy=m.module_dynamic||{},major=dy.major||{},op=major.opus,archive=major.archive,article=major.article;
   let desc=dy.desc?.text||op?.summary?.text||'';
   const orig=d.orig?.modules?.module_dynamic;if(orig)desc+=`\n转发：${orig.desc?.text||orig.major?.archive?.title||orig.major?.opus?.summary?.text||''}`;
   return finish({title:op?.title||archive?.title||article?.title||`${m.module_author?.name||'用户'}的${labels[t]}`,author:m.module_author?.name,description:desc,images:[op?.pics?.[0]?.url||major.draw?.items?.[0]?.src||archive?.cover||article?.covers?.[0]],stats:[['点赞',m.module_stat?.like?.count],['评论',m.module_stat?.comment?.count],['转发',m.module_stat?.forward?.count]]});
  }
  if(t==='live'){
   const d=await this.api('/room/v1/Room/get_info',{room_id:id},'https://api.live.bilibili.com');
   return finish({title:d.title,author:d.uname||`UID ${d.uid}`,description:strip(d.description),images:[d.user_cover||d.keyframe],details:[['未开播','正在直播','轮播中'][d.live_status]||'状态未知',d.area_name],stats:[['人气',d.online]]});
  }
  if(t==='article'||t==='note'){
   const d=await this.api('/x/article/viewinfo',{id});return finish({title:d.title||`${labels[t]} cv${id}`,author:d.author_name,description:d.summary||'',images:d.origin_image_urls||d.image_urls||[d.banner_url],stats:[['阅读',d.stats?.view],['点赞',d.stats?.like]]});
  }
  if(t==='user'){
   const d=await this.api('/x/web-interface/card',{mid:id});const c=d.card||{};
   if(!c.name)throw new BiliError('FORMAT','用户信息缺失');return finish({title:c.name,description:c.sign,images:[c.face],details:[`UID ${id}`],stats:[['粉丝',d.follower??c.fans],['关注',c.attention],['投稿',d.archive_count]]});
  }
  if(t==='favorite_list'){
   const d=await this.api('/x/v3/fav/folder/info',{media_id:id});return finish({title:d.title,author:d.upper?.name,description:d.intro,images:[d.cover],stats:[['内容',d.media_count],['收藏',d.cnt_info?.collect]]});
  }
  if(t==='audio'||t==='audio_list'){
   const d=await this.api(t==='audio'?'/audio/music-service-c/web/song/info':'/audio/music-service-c/web/menu/info',{sid:id},'https://www.bilibili.com');return finish({title:d.title,author:d.author||d.uname,description:d.intro,images:[d.cover],stats:[['播放',d.statistic?.play]]});
  }
  if(t==='article_list'){
   const d=await this.api('/x/article/list/web/articles',{id});return finish({title:d.readlist?.name||d.readlist?.title||`文集 ${id}`,author:d.author?.name,description:d.readlist?.summary,images:[d.readlist?.image_url||d.articles?.[0]?.image_urls?.[0]],stats:[['文章',d.readlist?.articles_count??d.articles?.length]]});
  }
  // These less common forms retain recognition and the canonical link, without inventing metadata.
  return finish({title:`已识别：${labels[t]}`,description:'此类型目前提供链接识别，请打开链接查看详细内容。',details:[`编号 ${id}`],limited:true});
 }
}
function strip(s){return String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');}
function duration(n){n=Number(n)||0;return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
const count=v=>{const n=Number(v);return n>=1e8?`${(n/1e8).toFixed(1)}亿`:n>=1e4?`${(n/1e4).toFixed(1)}万`:String(v);};
export function formatInfo(d,c){
 const clean=s=>String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
 const lines=[`【B站${labels[d.type]||'内容'}】${clean(d.title).slice(0,240)}`];
 if(d.author)lines.push(`UP主：${clean(d.author).slice(0,80)}`);
 if(d.details?.filter(Boolean).length)lines.push(d.details.filter(Boolean).join(' · '));
 if(c.showStats&&d.stats?.some(x=>x[1]!=null))lines.push(d.stats.filter(x=>x[1]!=null).map(([k,v])=>`${k} ${count(v)}`).join(' · '));
 if((c.showDescription||d.limited)&&d.description){const s=clean(d.description);lines.push(s.slice(0,c.descriptionLength)+(s.length>c.descriptionLength?'…':''));}
 lines.push(d.url);return lines.join('\n');
}
