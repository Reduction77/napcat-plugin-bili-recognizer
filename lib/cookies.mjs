import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const validName=n=>/^[!#$%&'*+.^_`|~0-9a-zA-Z-]{1,128}$/.test(n);
const validValue=v=>typeof v==='string'&&v.length<=8192&&!/[\x00-\x20\x7f;,]/.test(v);
const supported=h=>['bilibili.com','biligame.com'].some(d=>h===d||h.endsWith('.'+d));
const domainMatch=(host,domain)=>host===domain||host.endsWith('.'+domain);
export function setCookieHeaders(headers){return headers.getSetCookie?.()||String(headers.get('set-cookie')||'').split(/,(?=\s*[^;,=\s]+=)/);}
export class CookieJar {
 constructor(entries=[]){this.entries=[];for(const c of entries.slice(0,256))if(validName(c.name)&&validValue(c.value)&&supported(c.domain||'')&&typeof c.path==='string'&&c.path.startsWith('/'))this.put({...c,hostOnly:!!c.hostOnly,secure:!!c.secure,expiresAt:Number(c.expiresAt)||null});}
 put(c){this.entries=this.entries.filter(x=>!(x.name===c.name&&x.domain===c.domain&&x.path===c.path));if(!c.expiresAt||c.expiresAt>Date.now())this.entries.push(c);if(this.entries.length>256)this.entries.shift();}
 ingest(headers,url){const u=new URL(url);if(u.protocol!=='https:'||!supported(u.hostname))return;for(const line of setCookieHeaders(headers)){
  const parts=line.split(';'),pair=parts.shift(),i=pair.indexOf('=');if(i<1)continue;const name=pair.slice(0,i).trim(),value=pair.slice(i+1).trim().replace(/^"|"$/g,'');if(!validName(name)||!validValue(value))continue;
  const attrs=new Map(parts.map(p=>{const i=p.indexOf('=');return i<0?[p.trim().toLowerCase(),'']:[p.slice(0,i).trim().toLowerCase(),p.slice(i+1).trim()];}));
  const domain=(attrs.get('domain')||u.hostname).replace(/^\./,'').toLowerCase();if(!supported(domain)||!domainMatch(u.hostname,domain))continue;
  const parent=u.pathname.slice(0,u.pathname.lastIndexOf('/'))||'/';const cookiePath=attrs.get('path')?.startsWith('/')?attrs.get('path'):parent;
  const secure=attrs.has('secure'),hostOnly=!attrs.has('domain');if(name.startsWith('__Secure-')&&!secure||name.startsWith('__Host-')&&(!secure||!hostOnly||cookiePath!=='/'))continue;
  let expiresAt=Date.parse(attrs.get('expires'));if(attrs.has('max-age')&&/^-?\d+$/.test(attrs.get('max-age')))expiresAt=Date.now()+Number(attrs.get('max-age'))*1000;
  this.put({name,value,domain,path:cookiePath,hostOnly,secure,expiresAt:Number.isFinite(expiresAt)?expiresAt:null});
 }}
 importLegacy(cookie){for(const part of String(cookie||'').split(';')){const i=part.indexOf('=');if(i<1)continue;const name=part.slice(0,i).trim(),value=part.slice(i+1).trim();if(validName(name)&&validValue(value))this.put({name,value,domain:'bilibili.com',path:'/',hostOnly:false,secure:true,expiresAt:null});}}
 header(url){const u=new URL(url);if(u.protocol!=='https:'||!supported(u.hostname))return '';return this.export().filter(c=>(c.hostOnly?u.hostname===c.domain:domainMatch(u.hostname,c.domain))&&(u.pathname===c.path||u.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))).sort((a,b)=>b.path.length-a.path.length).map(c=>`${c.name}=${c.value}`).join('; ');}
 export(){return this.entries.filter(c=>!c.expiresAt||c.expiresAt>Date.now()).map(c=>({...c}));}
 clone(){return new CookieJar(this.export());}
 devices(){return new CookieJar(this.export().filter(c=>/^(buvid\d*|b_nut|b_lsid|_uuid|fingerprint)$/.test(c.name)));}
}
const hash=s=>createHash('sha256').update(String(s||'')).digest('hex');
export class SessionStore {
 constructor(root,cookie){this.file=path.join(root,'bili-session.json');this.configHash=hash(cookie);this.loaded=false;this.jar=new CookieJar();this.jar.importLegacy(cookie);this.dm=null;this.refreshToken='';this.tail=Promise.resolve();this.persisted=null;}
 async init(){try{const d=JSON.parse(await fs.readFile(this.file,'utf8'));if(d.version===1&&d.configHash===this.configHash){this.loaded=true;this.jar=new CookieJar(d.cookies||[]);this.dm=d.dm||null;this.refreshToken=typeof d.refreshToken==='string'?d.refreshToken:'';}}catch(e){if(e.code!=='ENOENT')this.loadFailed=true;}}
 async reset(cookie,snapshot){this.configHash=hash(cookie);this.jar=snapshot?new CookieJar(snapshot.cookies||[]):new CookieJar();if(!snapshot)this.jar.importLegacy(cookie);this.dm=null;this.refreshToken=snapshot?.refreshToken||'';await this.save();}
 save(){const content=JSON.stringify({version:1,configHash:this.configHash,cookies:this.jar.export(),dm:this.dm,refreshToken:this.refreshToken});const task=this.tail.catch(()=>{}).then(async()=>{if(content===this.persisted)return;await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await fs.writeFile(this.file+'.tmp',content,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);this.persisted=content;});this.tail=task;return task;}
 async flush(){await this.tail;}
}
