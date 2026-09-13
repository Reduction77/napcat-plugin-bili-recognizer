import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LiveMonitor,parseLiveInput,fetchLive} from '../lib/live.mjs';

async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-live-'));let status=0,fetchError=null,hold=null,sendHook=null;
 const calls=[],sent=[],logs=[];
 const client={async api(endpoint,params,host){calls.push({endpoint,params,host});if(hold)await hold;if(fetchError)throw fetchError;
  if(endpoint.endsWith('room_init'))return {uid:123};
  const uid=params['uids[]'];return {[uid]:{room_id:456,live_status:status,uname:'主播',title:'测试直播',live_time:Math.floor(Date.now()/1000)-3600}};
 }};
 const state={client,closed:false,gate:{snapshot:()=>({})}};
 const make=()=>new LiveMonitor(dir,()=>state,async(group,text)=>{sent.push({group,text});await sendHook?.(group);},(...a)=>logs.push(a));
 const m=make();await m.init();
 t.after(async()=>{await m.close();await fs.rm(dir,{recursive:true,force:true});});
 const add=(patch={})=>m.upsert({revision:m.data.revision,input:'123',type:'uid',label:'',groups:['111','222'],enabled:true,start:true,end:true,...patch});
 const enable=()=>m.settings({revision:m.data.revision,enabled:true,intervalSeconds:60});
 return {m,dir,state,make,add,enable,sent,calls,logs,setStatus:n=>status=n,setError:e=>fetchError=e,setHold:p=>hold=p,setSend:f=>sendHook=f};
}

test('直播输入区分 UID 与房间号，拒绝外部链接',()=>{
 assert.deepEqual(parseLiveInput('123','room'),{type:'room',id:'123'});
 assert.deepEqual(parseLiveInput('https://space.bilibili.com/123?x=1'),{type:'uid',id:'123'});
 assert.deepEqual(parseLiveInput('https://live.bilibili.com/456'),{type:'room',id:'456'});
 for(const value of ['0','-1','https://evil.example/123','https://user@live.bilibili.com/123','https://live.bilibili.com:8443/123'])assert.throws(()=>parseLiveInput(value));
});
test('默认不开启直播请求，短房间号解析为 UID，重复订阅更新而非重复添加',async t=>{
 const x=await setup(t);await x.m.check();assert.equal(x.calls.length,0);
 await x.add({input:'https://live.bilibili.com/77'});await x.add({groups:'111,333'});
 assert.equal(x.m.data.subscriptions.length,1);assert.deepEqual(x.m.data.subscriptions[0].groups,['111','333']);
 assert.equal(x.calls[0].endpoint,'/room/v1/Room/room_init');
 assert.equal(x.calls[1].host,'https://api.live.bilibili.com');assert.equal(x.calls[1].params['uids[]'],'123');assert.equal(x.sent.length,0);
});
test('首次检查建立基线，开播只通知一次，连续两次停播才通知并保留时长',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();assert.equal(x.sent.length,0);
 x.setStatus(1);await x.m.check();await x.m.check();assert.equal(x.sent.length,2);assert.match(x.sent[0].text,/开播通知/);
 x.setStatus(0);await x.m.check();assert.equal(x.sent.length,2);await x.m.check();await x.m.check();assert.equal(x.sent.length,4);assert.match(x.sent[2].text,/下播通知/);assert.match(x.sent[2].text,/1 小时/);
});
test('已开播时新增订阅不补发，轮播不会作为开播',async t=>{
 const x=await setup(t);x.setStatus(1);await x.add();await x.enable();await x.m.check();assert.equal(x.sent.length,0);
 x.setStatus(2);await x.m.check();await x.m.check();assert.equal(x.sent.length,2);assert.match(x.sent[0].text,/下播/);await x.m.check();assert.equal(x.sent.length,2);
});
test('412 和未知状态不视作下播，失败打断连续下播确认',async t=>{
 const x=await setup(t);x.setStatus(1);await x.add();await x.enable();await x.m.check();
 x.setStatus(0);await x.m.check();x.setError(Object.assign(new Error('rate'),{code:'412'}));await x.m.check();assert.equal(x.sent.length,0);assert.equal(x.m.data.states['123'].phase,'live');
 x.setError(null);x.setStatus(99);await x.m.check();assert.equal(x.sent.length,0);assert(x.m.snapshot().errors['123']);
 x.setStatus(0);await x.m.check();assert.equal(x.sent.length,0);await x.m.check();assert.equal(x.sent.length,2);
});
test('重启后保留状态与发送记录，当前状态相同不会重复通知',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);await x.m.check();await x.m.close();
 const second=x.make();t.after(()=>second.close());await second.init();await second.check();assert.equal(x.sent.length,2);assert.equal(second.data.records.length,2);
 x.setStatus(0);await second.check();await second.check();assert.equal(x.sent.length,4);
});
test('检查期间删除、关闭、切换客户端，不向旧目标发送通知',async t=>{
 for(const action of ['remove','disable','client']){
  const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);
  let release;const hold=new Promise(r=>release=r);x.setHold(hold);const pending=x.m.check();
  if(action==='remove')await x.m.remove({uid:'123',revision:x.m.data.revision});
  if(action==='disable')await x.m.settings({enabled:false,intervalSeconds:60,revision:x.m.data.revision});
  if(action==='client')x.state.client={};
  release();await pending;assert.equal(x.sent.length,0,action);
 }
});
test('部分群发送失败继续其他群，回执超时不重发，尝试已持久化',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();
 x.setSend(async group=>{const disk=JSON.parse(await fs.readFile(x.m.file,'utf8'));assert(disk.records.some(r=>r.group===group&&r.status==='attempting'));if(group==='111')throw Error('timeout');});
 x.setStatus(1);await x.m.check();await x.m.check();assert.equal(x.sent.length,2);
 assert.deepEqual(x.m.data.records.map(r=>r.status),['sent','uncertain']);
});
test('单独关闭下播通知，重新启用时重新建立基线',async t=>{
 const x=await setup(t);await x.add({end:false});await x.enable();await x.m.check();x.setStatus(1);await x.m.check();x.setStatus(0);await x.m.check();await x.m.check();assert.equal(x.sent.length,2);
 await x.m.settings({revision:x.m.data.revision,enabled:false,intervalSeconds:60});x.setStatus(1);await x.enable();await x.m.check();assert.equal(x.sent.length,2);
});
test('订阅校验和版本冲突不会覆盖已保存数据',async t=>{
 const x=await setup(t);await x.add();await assert.rejects(x.add({revision:0}),/其他页面/);
 for(const patch of [{groups:['123;456']},{groups:[]},{start:false,end:false},{enabled:'true'}])await assert.rejects(x.add(patch));
 assert.equal(x.m.data.subscriptions.length,1);
 await assert.rejects(x.m.settings({enabled:true,intervalSeconds:0,revision:1}),/间隔/);
});
test('并发检查复用同一轮，关闭后不再调度；损坏数据不阻止插件初始化且不覆盖原文件',async t=>{
 const x=await setup(t);await x.add();await x.enable();let release;x.setHold(new Promise(r=>release=r));const a=x.m.check(),b=x.m.check();assert.equal(a,b);release();await a;await x.m.close();assert.equal(x.m.nextCheckAt,0);
 await fs.writeFile(x.m.file,'broken');const second=x.make();t.after(()=>second.close());await second.init();assert.match(second.snapshot().loadError,/读取失败/);await assert.rejects(second.settings({enabled:true,intervalSeconds:60,revision:0}),/读取失败/);assert.equal(await fs.readFile(x.m.file,'utf8'),'broken');
});
test('状态持久化失败时不发送通知',async t=>{
 const x=await setup(t);await x.add();await x.enable();await x.m.check();x.setStatus(1);
 await fs.mkdir(x.m.file+'.tmp');await x.m.check();assert.equal(x.sent.length,0);assert.equal(x.m.data.states['123'].phase,'offline');
});
test('直播接口没有对应 UID 时不误取其他主播的数据',async()=>{
 await assert.rejects(fetchLive({api:async()=>({'999':{room_id:999,live_status:1}})},'123'),/未取得/);
});
