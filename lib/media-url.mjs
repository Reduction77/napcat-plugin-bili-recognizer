import {BiliError} from './net.mjs';
const domains=['bilivideo.com','bilivideo.cn','bilivideo.net','acgvideo.com'];
export function inspectMediaUrl(value){
 const fail=reason=>({url:null,reason,host:null,port:null,protocol:null});
 if(typeof value!=='string'||!value.trim())return fail('MISSING_URL');
 let raw=value.trim();if(raw.length>16384)return fail('URL_TOO_LONG');
 if(/[\x00-\x20\x7f\\]/.test(raw))return fail('INVALID_CHARACTERS');
 if(raw.startsWith('//'))raw='https:'+raw;
 let u;try{u=new URL(raw);}catch{return fail('INVALID_URL');}
 const meta={host:u.hostname,port:u.port||null,protocol:u.protocol};
 if(!['https:','http:'].includes(u.protocol))return fail('UNSUPPORTED_SCHEME');
 if(u.username||u.password)return fail('USERINFO_NOT_ALLOWED');
 if(!domains.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return {...meta,url:null,reason:'HOST_NOT_ALLOWED'};
 // CDN nodes may use explicit ports. Preserve the API's scheme, port and signed
 // path/query exactly; rewriting HTTP to HTTPS can target the wrong service.
 return {...meta,url:raw,reason:null};
}
export const mediaUrl=value=>inspectMediaUrl(value).url;
export function streamSource(stream,size=0){
 const backups=[stream.backup_url,stream.backupUrl].flatMap(x=>Array.isArray(x)?x:typeof x==='string'?[x]:[]);
 const raw=[stream.url,stream.baseUrl,stream.base_url,...backups].filter(x=>typeof x==='string'&&x.trim()).slice(0,24);
 const candidates=[...new Set(raw)].map(inspectMediaUrl);
 const rank=c=>(c.protocol==='https:'?0:2)+(c.port?1:0);
 const valid=candidates.filter(c=>c.url).sort((a,b)=>rank(a)-rank(b));
 if(valid.length)return {url:valid[0].url,urls:valid.map(c=>c.url),size};
 const e=new BiliError('MEDIA_URL','没有可用的视频流地址');
 e.mediaCandidates=(candidates.length?candidates:[inspectMediaUrl(null)]).map(({host,port,protocol,reason})=>({host,port,protocol,reason}));throw e;
}
