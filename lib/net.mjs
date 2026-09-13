import {setTimeout as delay} from 'node:timers/promises';
export const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
export class BiliError extends Error {constructor(code,message){super(message);this.code=String(code);}}
export async function readJson(response,limit=2*1024*1024){
 const reader=response.body?.getReader();if(!reader)throw new BiliError('JSON','接口未返回内容');const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new BiliError('SIZE','接口响应过大');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BiliError('JSON','接口未返回 JSON');}
}
export class RequestGate {
 constructor(getConfig){this.getConfig=getConfig;this.until=0;this.next=0;this.tail=Promise.resolve();this.lastCode='';}
 snapshot(){return {pausedUntil:this.until,lastCode:this.lastCode,requestGapMs:this.getConfig().requestGapMs};}
 hit(code,retryAfter){if(!['-352','-412','412','429'].includes(String(code)))return;this.lastCode=String(code);let seconds=Number(retryAfter);if(!Number.isFinite(seconds))seconds=(Date.parse(retryAfter)-Date.now())/1000;const wait=Math.max(this.getConfig().riskCooldownSeconds||300,Number.isFinite(seconds)?seconds:0);this.until=Math.max(this.until,Date.now()+Math.min(wait,3600)*1000);}
 async enter(signal){const task=this.tail.catch(()=>{}).then(async()=>{signal?.throwIfAborted();if(this.until>Date.now())throw new BiliError('BACKOFF','B站请求暂停中');const wait=Math.max(0,this.next-Date.now());if(wait)await delay(wait,undefined,{signal});if(this.until>Date.now())throw new BiliError('BACKOFF','B站请求暂停中');this.next=Date.now()+(this.getConfig().requestGapMs||0);});this.tail=task;return task;}
}
