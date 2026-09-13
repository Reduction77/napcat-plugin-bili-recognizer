import {UA} from './net.mjs';
export const REQUEST_META=Symbol('bili-request-meta');
export const numericCode=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function cookieSummary(cookie=''){
 const names=String(cookie).split(';').map(s=>s.slice(0,s.indexOf('=')).trim()).filter(s=>/^[A-Za-z0-9_-]{1,80}$/.test(s));
 const uid=String(cookie).match(/(?:^|;\s*)DedeUserID=(\d+)(?:;|$)/)?.[1]||null;
 return {cookieNames:[...new Set(names)].sort(),login:/(?:^|;\s*)SESSDATA=[^;\s]+/.test(String(cookie)),uid};
}
export function requestMeta(url,{method='GET',cookie='',referer='https://www.bilibili.com/',media=false}={}){
 const u=new URL(url),bvid=u.searchParams.get('bvid'),cid=u.searchParams.get('cid');
 return {time:Date.now(),method,host:u.hostname,endpoint:media?'[video CDN]':u.pathname,bvid:/^BV[a-zA-Z0-9]{10}$/.test(bvid||'')?bvid:null,cid:/^\d+$/.test(cid||'')?cid:null,wbi:u.searchParams.has('w_rid'),parameterNames:[...u.searchParams.keys()].filter(x=>/^[a-zA-Z0-9_]{1,64}$/.test(x)).sort(),...cookieSummary(cookie),userAgent:UA,referer,httpStatus:null,biliCode:null,attempt:1,retryCount:0,durationMs:0};
}
export function traceLine(row){return `[BILI][${row.phase}] method=${row.method} endpoint=${row.endpoint} HTTP_STATUS=${row.httpStatus??'null'} BILI_CODE=${row.biliCode??'null'} login=${row.login} wbi=${row.wbi} bvid=${row.bvid??'-'} cid=${row.cid??'-'} attempt=${row.attempt??1} retry=${row.retryCount??0} duration=${row.durationMs}ms cookie_names=${row.cookieNames.join(',')} error=${row.error||'-'}${row.downloadFailure?' download_failure='+JSON.stringify(row.downloadFailure):''}${row.receivedBytes!==undefined?' received_bytes='+row.receivedBytes:''}${row.endpoint==='[video CDN]'?' media_host='+row.host:''}${row.mediaCandidates?' media_candidates='+JSON.stringify(row.mediaCandidates):''}${row.validation?' validation='+row.validation:''}${row.loginStage?' stage='+row.loginStage+' hop='+row.redirectHop+' missing_cookies='+(row.missingCookies||[]).join(','):''}`;}
export function emitTrace(sink,row){try{sink?.({...row});}catch{/* Diagnostics must never break requests. */}}
