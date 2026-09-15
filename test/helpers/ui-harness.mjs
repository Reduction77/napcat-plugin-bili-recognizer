import vm from 'node:vm';
import fs from 'node:fs/promises';
export const liveFixture=()=>({revision:2,enabled:true,intervalSeconds:60,control:'auto',scheduleEnabled:true,windows:[{startTime:'19:00',endTime:'23:30'}],continueUntilEnd:true,subscriptions:Array.from({length:20},(_,i)=>({uid:String(i+100),label:'主播'+i,groups:['111','222'],enabled:true,start:true,end:true})),states:Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+100),{roomId:String(i+1000),name:'主播'+i,title:'直播标题',phase:'offline',status:0,startAt:0,checkedAt:1000}])),records:Array.from({length:100},(_,i)=>({id:'record-'+i,uid:String(i%20+100),group:'111',kind:'start',source:'manual',time:1000+i,status:'sent',text:'通知正文'.repeat(100)})),manualSending:[],running:false,nextCheckAt:10000});
export async function uiHarness(source){
 source??=await fs.readFile(new URL('../../webui/app.js',import.meta.url),'utf8');
 let now=100000;const nodes=new Map(),listeners={},intervals=[],requests=[],writes=new Map();
 const node=id=>{if(!nodes.has(id)){let html='';const el={id,textContent:'',value:'all',checked:false,disabled:false,hidden:false,dataset:{},classList:{toggle(){},contains(){return false;}},setAttribute(){},focus(){},scrollIntoView(){}};Object.defineProperty(el,'innerHTML',{get:()=>html,set:value=>{html=value;writes.set(id,(writes.get(id)||0)+1);if(id==='#content')for(const key of nodes.keys())if(key.startsWith('#live-')||['#record-table','#log-list','#diagnosis-result','#download-jobs','#download-risk'].includes(key))nodes.delete(key);}});nodes.set(id,el);}return nodes.get(id);};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context=vm.createContext({console,Date:Clock,URL,AbortSignal,window:{BILI_BASE:'/bili',addEventListener(){}},document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener:(event,fn)=>(listeners[event]??=[]).push(fn),body:{classList:{add(){}}}},localStorage:{getItem:()=> 'light'},setInterval:fn=>intervals.push(fn),setTimeout:()=>1,clearTimeout(){},confirm:()=>true,fetch:async(url,opts)=>{requests.push({url,body:opts.body});return {ok:true,status:200,json:async()=>({code:0,data:liveFixture()})};}});
 vm.runInContext(await fs.readFile(new URL('../../webui/download-details.js',import.meta.url),'utf8'),context);vm.runInContext(source.replace("navigate('status');",''),context);
 // 卡片面板会额外请求 /live/card，轮询相关断言只看业务请求。
 const polling=()=>requests.filter(r=>!String(r.url).endsWith('/live/card'));
 return {context,node,listeners,intervals,requests,polling,writes,eval:code=>vm.runInContext(code,context),time:value=>now=value,tick:async delta=>{now+=delta;for(const fn of intervals)await fn();}};
}
