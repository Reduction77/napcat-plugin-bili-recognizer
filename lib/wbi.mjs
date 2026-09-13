// Protocol compatibility reference: yt-dlp bilibili.py, e8de28e23c1ecb4a12b2c3dec188c07e998c412c.
import {createHash,randomInt} from 'node:crypto';
import {BiliError} from './net.mjs';
const MIXIN=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function mixinKey(img,sub){try{const key=[img,sub].map(x=>new URL(x).pathname.split('/').pop().split('.')[0]).join('');if(!/^[a-fA-F0-9]{64}$/.test(key))throw 0;return MIXIN.map(i=>key[i]).join('').slice(0,32);}catch{throw new BiliError('WBI_KEY','未取得有效 WBI 签名材料');}}
// Python urllib.parse.urlencode / quote_plus semantics, including spaces and '~'.
const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
export function signWbi(input,key,now=Date.now()){
 const params={};for(const name of Object.keys({...input,wts:Math.round(now/1000)}).filter(k=>k!=='w_rid').sort())params[name]=String(name==='wts'?Math.round(now/1000):input[name]).replace(/[!'()*]/g,'');
 const query=Object.entries(params).map(([k,v])=>`${encode(k)}=${encode(v)}`).join('&');const rid=createHash('md5').update(query+key).digest('hex');return {params:{...params,w_rid:rid},query:query+'&w_rid='+rid};
}
export function makeDm(){
 const printable='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r\x0b\x0c';
 const encoded=(min,max)=>Buffer.from(Array.from({length:randomInt(min,max+1)},()=>printable[randomInt(printable.length)]).join('')).toString('base64').slice(0,-2);
 const w=1920,h=1080,r=randomInt(114),s=randomInt(514),top=randomInt(101);
 return {dm_img_list:'[]',dm_img_str:encoded(16,64),dm_cover_img_str:encoded(32,128),dm_img_inter:JSON.stringify({ds:[],wh:[2*w+2*h+3*r,4*w-h+r,r],of:[3*top+s,4*top+2*s,s]})};
}
export function validDm(d){return d&&['dm_img_list','dm_img_str','dm_cover_img_str','dm_img_inter'].every(k=>typeof d[k]==='string'&&d[k].length<2048);}
