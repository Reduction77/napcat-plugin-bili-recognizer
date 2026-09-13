import {randomUUID} from 'node:crypto';
import qr from './vendor/qrcode.cjs';
import {UA,BiliError,readJson} from './net.mjs';
import {CookieJar} from './cookies.mjs';
import {REQUEST_META,requestMeta,numericCode,emitTrace} from './trace.mjs';
const PASSPORT='https://passport.bilibili.com';
const LEGACY_QUERY_COOKIE_KEYS=new Set(['SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','buvid3','buvid4','sid','b_nut','b_lsid','_uuid','fingerprint']);
export function cookiesFromHeaders(headers){const jar=new CookieJar();jar.ingest(headers,PASSPORT+'/');return Object.fromEntries(jar.export().map(c=>[c.name,c.value]));}
export function loginUrl(value,crossOnly=false){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;if(crossOnly){if(!['passport.bilibili.com','passport.biligame.com'].includes(u.hostname)||!u.pathname.endsWith('/crossDomain')||!u.searchParams.get('ticket'))return null;}else if(!['passport.bilibili.com','passport.biligame.com','www.bilibili.com'].includes(u.hostname))return null;return u;}catch{return null;}}
// Server-returned HTTP exchange links are upgraded locally; no ticket or Cookie
// is sent over HTTP. Network requests still pass the original loginUrl allowlist.
export function exchangeUrl(value,base,crossOnly=false){
 try{if(typeof value!=='string'||!value.trim()||/[\x00-\x20\x7f\\]/.test(value))return null;const u=new URL(value,base);
  if(u.username||u.password||u.port||!['http:','https:'].includes(u.protocol))return null;
  u.protocol='https:';return loginUrl(u.href,crossOnly);
 }catch{return null;}
}
// Only call this with data.url from our fixed HTTPS generate API, never user input.
// The QR is opaque display data, not a backend fetch target. Trust its authenticated
// source instead of maintaining a second, incomplete list of QR landing domains.
// Keep loginUrl's separate HTTPS/host restrictions for requests and cookie exchange.
export function qrContent(value){
 const fail=reason=>({ok:false,reason});
 if(typeof value!=='string'||!value.trim())return fail('MISSING_URL');
 const raw=value.trim();if(raw.length>2048)return fail('URL_TOO_LONG');if(/[\x00-\x20\x7f\\]/.test(raw))return fail('INVALID_CHARACTERS');
 let u;try{u=new URL(raw);}catch{return fail('INVALID_URL');}
 if(!['https:','http:'].includes(u.protocol))return fail('UNSUPPORTED_SCHEME');
 if(u.username||u.password)return fail('USERINFO_NOT_ALLOWED');if(u.port)return fail('PORT_NOT_ALLOWED');
 return {ok:true,url:raw};
}
function queryCookies(url){const out={};const u=exchangeUrl(url);if(u)for(const k of LEGACY_QUERY_COOKIE_KEYS){const v=u.searchParams.get(k);if(v&&!/[;\r\n]/.test(v))out[k]=k==='SESSDATA'?v.replace(/,/g,'%2C'):v;}return out;}
const complete=c=>c.SESSDATA&&c.bili_jct&&/^\d+$/.test(c.DedeUserID||'');
export function qrImage(url){const code=qr(0,'M');code.addData(url);code.make();return 'data:image/svg+xml;base64,'+Buffer.from(code.createSvgTag({cellSize:5,margin:20,scalable:true})).toString('base64');}
export class QrLogin {
 constructor(getState,persist,fetcher=globalThis.fetch){this.getState=getState;this.persist=persist;this.fetcher=fetcher;this.current=null;this.account=null;this.checkPromise=null;this.lastCheck=0;this.lastGenerate=0;this.generating=false;this.generation=0;this.closed=false;this.abort=new AbortController();}
 close(){this.closed=true;this.current=null;this.abort.abort();}
 cancel(){this.generation++;this.current=null;}
 resetAccount(){this.account=null;this.lastCheck=0;}
 async request(url,jar,json=false){
  const u=loginUrl(url);if(!u)throw new BiliError('LOGIN_URL','登录返回的地址不受支持');if(this.riskUntil>Date.now())throw new BiliError('BACKOFF','登录接口正在冷却');
  const cookie=jar.header(url),trace=requestMeta(url,{cookie}),start=Date.now();emitTrace(this.getState().onTrace,{...trace,phase:'REQUEST'});
  try{const r=await this.fetcher(u.href,{redirect:'manual',headers:{'User-Agent':UA,Referer:'https://www.bilibili.com/',Accept:json?'application/json, text/plain, */*':'*/*','Accept-Language':'zh-CN,zh;q=0.9',...(cookie?{Cookie:cookie}:{})},signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)])});
   trace.httpStatus=r.status;jar.ingest(r.headers,url);if((json&&r.status!==200)||(!r.ok&&!(r.status>=300&&r.status<400))){await r.body?.cancel();throw new BiliError(String(r.status),'登录接口请求失败');}
   const data=json?await readJson(r,128*1024):r;if(json)trace.biliCode=numericCode(data?.code);if(data&&typeof data==='object')Object.defineProperty(data,REQUEST_META,{value:{...trace,durationMs:Date.now()-start}});
   if([-352,-412].includes(trace.biliCode))throw new BiliError(trace.biliCode,'登录接口请求受限');
   emitTrace(this.getState().onTrace,{...trace,phase:'RESPONSE',durationMs:Date.now()-start});return data;
  }catch(e){const risk=[412,429].includes(trace.httpStatus)||[-352,-412].includes(trace.biliCode);if(risk){this.riskUntil=Date.now()+300000;this.getState().gate?.hit(trace.biliCode??trace.httpStatus);}
   emitTrace(this.getState().onTrace,{...trace,phase:risk?'RISK':'ERROR',durationMs:Date.now()-start,error:'LOGIN_REQUEST_FAILED'});e.diagnostic=trace;throw e;
  }
 }
 async generate(){
  if(this.generating||Date.now()-this.lastGenerate<5000)throw new BiliError('LOGIN_WAIT','请稍候再生成二维码');
  this.generating=true;this.lastGenerate=Date.now();const generation=++this.generation;this.current=null;try{
   const jar=this.getState().client?.jar?.devices()||new CookieJar();const j=await this.request(PASSPORT+'/x/passport-login/web/qrcode/generate',jar,true),data=j?.data;
   const issue=(code,reason)=>{const e=new BiliError(code,reason);e.reason=reason;e.diagnostic={...(j?.[REQUEST_META]||requestMeta(PASSPORT+'/x/passport-login/web/qrcode/generate')),phase:'ERROR',error:code,validation:reason};emitTrace(this.getState().onTrace,e.diagnostic);return e;};
   if(j?.code!==0||typeof data?.qrcode_key!=='string'||!data.qrcode_key.trim()||data.qrcode_key.length>1024)throw issue('LOGIN_FORMAT','MISSING_QR_DATA');
   const content=qrContent(data.url);if(!content.ok)throw issue('LOGIN_QR_URL',content.reason);
   let image;try{image=qrImage(content.url);}catch{throw issue('LOGIN_QR_RENDER','QR_RENDER_FAILED');}
   this.abort.signal.throwIfAborted();if(generation!==this.generation)throw new BiliError('LOGIN_SESSION','登录已取消');const s={jar,id:randomUUID(),key:data.qrcode_key,expiresAt:Date.now()+180000,lastPoll:0,state:'waiting',pollPromise:null,cookieAtStart:this.getState().config.cookie};this.current=s;
   return {sessionId:s.id,image,expiresAt:s.expiresAt,state:s.state};
  }finally{this.generating=false;}
 }
 async poll(id){
  const s=this.current;if(!s||s.id!==id)throw new BiliError('LOGIN_SESSION','二维码已取消或替换，请重新生成');
  if(s.state==='success')return {state:'success',uid:s.uid};
  if(s.state==='expired'||Date.now()>s.expiresAt){s.key='';s.state='expired';return {state:'expired'};}
  if(s.pollPromise)return s.pollPromise;
  if(Date.now()-s.lastPoll<4000)return {state:s.state};s.lastPoll=Date.now();
  s.pollPromise=this.doPoll(s).finally(()=>s.pollPromise=null);return s.pollPromise;
 }
 async doPoll(s){
  const j=await this.request(PASSPORT+'/x/passport-login/web/qrcode/poll?qrcode_key='+encodeURIComponent(s.key),s.jar,true);if(j.code!==0)throw new BiliError(j.code,'查询登录状态失败');const d=j.data||{};
  if(this.current!==s||this.closed)throw new BiliError('LOGIN_SESSION','登录已取消');
  if(d.code!==0){const state={86101:'waiting',86090:'scanned',86038:'expired'}[d.code];if(!state)throw new BiliError('LOGIN_STATE','登录接口返回未知状态');s.state=state;if(state==='expired')s.key='';return {state};}
  const importQuery=url=>s.jar.importLegacy(Object.entries(queryCookies(url)).map(([k,v])=>`${k}=${v}`).join('; '));
  const auth=()=>Object.fromEntries(s.jar.header('https://api.bilibili.com/').split('; ').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
  let lastMeta=j[REQUEST_META],hop=0;
  const issue=(code,reason)=>{const c=auth(),e=new BiliError(code,reason);e.reason=reason;e.missingCookies=['SESSDATA','bili_jct','DedeUserID'].filter(k=>k==='DedeUserID'?!/^\d+$/.test(c[k]||''):!c[k]);e.diagnostic={...lastMeta,phase:'ERROR',error:code,validation:reason,loginStage:'exchange',redirectHop:hop,missingCookies:e.missingCookies};emitTrace(this.getState().onTrace,e.diagnostic);return e;};
  importQuery(d.url);
  const first=exchangeUrl(d.url,undefined,true);
  if(!complete(auth())&&first){
   let url=first.href;
   for(hop=1;hop<=10;hop++){
    if(this.current!==s||this.closed)throw new BiliError('LOGIN_SESSION','登录已取消');
    const res=await this.request(url,s.jar);lastMeta=res[REQUEST_META];const location=res.headers.get('location');await res.body?.cancel();
    if(this.current!==s||this.closed)throw new BiliError('LOGIN_SESSION','登录已取消');
    // request() already ingested this response's Set-Cookie, including on 302.
    // The final landing page is unnecessary once API-scoped credentials exist.
    if(complete(auth()))break;
    if(res.status>=300&&res.status<400&&location){
     const next=exchangeUrl(location,url);if(!next)throw issue('LOGIN_URL','REDIRECT_TARGET_REJECTED');
     url=next.href;importQuery(url);if(complete(auth()))break;
     if(hop===10)throw issue('LOGIN_REDIRECT_LIMIT','TOO_MANY_REDIRECTS');
    }else break;
   }
  }
  const cookies=auth();
  if(!complete(cookies))throw issue('LOGIN_COOKIES','INCOMPLETE_COOKIES');
  const cookie=s.jar.header('https://api.bilibili.com/');
  if(this.current!==s||this.closed)throw new BiliError('LOGIN_SESSION','登录已取消');
  await this.persist(cookie,s.cookieAtStart,()=>this.current===s&&!this.closed,{cookies:s.jar.export(),refreshToken:typeof d.refresh_token==='string'?d.refresh_token:''});
  s.state='success';s.key='';s.uid=cookies.DedeUserID;this.account={state:'saved',uid:s.uid,checkedAt:Date.now()};
  return {state:'success',uid:s.uid};
 }
 status(){return {configured:!!this.getState().config.cookie,...(this.account||{state:this.getState().config.cookie?'unchecked':'none'})};}
 async check(){
  if(!this.getState().config.cookie){this.account={state:'none'};return this.status();}
  if(this.checkPromise)return this.checkPromise;if(Date.now()-this.lastCheck<30000&&this.account)return this.status();this.lastCheck=Date.now();
  const client=this.getState().client;
  this.checkPromise=(async()=>{try{const d=await client.api('/x/web-interface/nav');if(client!==this.getState().client)return this.status();this.account=d.isLogin?{state:'valid',uid:String(d.mid),name:d.uname,checkedAt:Date.now()}:{state:'expired',checkedAt:Date.now()};}catch(e){if(client===this.getState().client)this.account={state:e.code==='-101'?'expired':'unknown',code:e.code||e.name,checkedAt:Date.now()};}return this.status();})().finally(()=>this.checkPromise=null);return this.checkPromise;
 }
}
