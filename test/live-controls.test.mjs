import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LiveMonitor} from '../lib/live.mjs';
import {scheduleDefaults,validateSchedule,liveWindow} from '../lib/live-schedule.mjs';
const clock=h=>Date.parse(`2026-09-13T${h}:00+08:00`);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bili-controls-'));let now=clock('19:00'),error=null,hold=null,sendHook=null,cool=0;
 const status={'123':0,'124':0},sent=[],requests=[],logs=[];
 const state={closed:false,gate:{snapshot:()=>({pausedUntil:cool})},client:{async api(endpoint,p){requests.push(p['uids[]']);if(hold)await hold;if(error)throw error;const uid=p['uids[]'];return {[uid]:{room_id:Number(uid)+1000,uname:'主播'+uid,title:'测试直播',live_status:status[uid],live_time:Math.floor(clock('18:00')/1000)}};}}};
 const make=()=>new LiveMonitor(dir,()=>state,async(group,text)=>{sent.push({group,text});await sendHook?.(group);},(level,message)=>logs.push({level,message}),{now:()=>now});
 const m=make();await m.init();m.schedule=()=>{};
 t.after(async()=>{await m.close();await fs.rm(dir,{recursive:true,force:true});});
 const add=(uid='123')=>m.upsert({revision:m.data.revision,input:uid,type:'uid',label:'',groups:['111','222'],enabled:true,start:true,end:true});
 const settings=(patch={})=>m.settings({revision:m.data.revision,enabled:true,intervalSeconds:60,scheduleEnabled:true,startTime:'18:00',endTime:'23:00',continueUntilEnd:true,...patch});
 const control=action=>m.control({revision:m.data.revision,action});
 const notify=(kind,patch={})=>m.manualNotify({revision:m.data.revision,uid:'123',kind,...patch});
 const drain=()=>Promise.all([...m.manualWorkers.values()]);
 return {m,make,dir,state,status,sent,requests,logs,add,settings,control,notify,drain,time:h=>now=clock(h),fail:e=>error=e,hold:p=>hold=p,send:f=>sendHook=f,cool:v=>cool=v};
}
test('北京时间时段边界与跨午夜，不受服务器本地时区影响',()=>{
 const d={...scheduleDefaults,scheduleEnabled:true};
 assert.equal(liveWindow(d,clock('17:59')).inside,false);assert.equal(liveWindow(d,clock('18:00')).inside,true);assert.equal(liveWindow(d,clock('23:00')).inside,false);
 assert.equal(liveWindow(d,clock('17:59')).nextOpenAt,clock('18:00'));assert.equal(liveWindow(d,clock('23:00')).nextOpenAt,clock('18:00')+86400000);
 d.startTime='22:00';d.endTime='02:00';for(const h of ['22:00','23:59','00:00','01:59'])assert.equal(liveWindow(d,clock(h)).inside,true,h);
 for(const h of ['02:00','21:59'])assert.equal(liveWindow(d,clock(h)).inside,false,h);
 for(const patch of [{startTime:'24:00'},{endTime:'1:00'},{startTime:'22:00',endTime:'22:00'}])assert.throws(()=>validateSchedule({...d,...patch}));
});
test('时段外零请求，窗口内发现开播后只跟踪直播中的主播到下播',async t=>{
 const x=await fixture(t);await x.add();await x.add('124');await x.settings();await x.m.check();
 x.status['123']=1;await x.m.check();assert.equal(x.sent.length,2);
 x.time('23:01');x.requests.length=0;await x.m.check();assert.deepEqual(x.requests,['123']);assert.equal(x.m.snapshot().detection['123'],'following');assert.equal(x.m.snapshot().detection['124'],'outside_window');
 x.status['123']=0;await x.m.check();await x.m.check();assert.equal(x.sent.length,4);x.requests.length=0;await x.m.check();assert.equal(x.requests.length,0);
 LiveMonitor.prototype.schedule.call(x.m);assert.equal(x.m.nextCheckAt,clock('18:00')+86400000);
});
test('关闭持续跟踪则到时停止；窗口外未开播主播不请求',async t=>{
 const x=await fixture(t);await x.add();await x.settings({continueUntilEnd:false});await x.m.check();x.status['123']=1;await x.m.check();x.time('23:00');x.requests.length=0;await x.m.check();assert.equal(x.requests.length,0);
});
test('时段外直播查询失败保留直播状态，412 冷却不能被手动开始绕过',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.m.check();x.status['123']=1;await x.m.check();x.time('23:01');x.fail(Object.assign(new Error('risk'),{code:'412'}));await x.m.check();assert.equal(x.m.data.states['123'].phase,'live');assert.equal(x.sent.length,2);
 x.cool(clock('23:10'));x.requests.length=0;await x.control('start');await x.m.check();assert.equal(x.requests.length,0);LiveMonitor.prototype.schedule.call(x.m);assert.equal(x.m.nextCheckAt,clock('23:10'));
});
test('手动开始覆盖时段，逐个下播后恢复自动；手动停止在重启后保留',async t=>{
 const x=await fixture(t);await x.add();await x.add('124');await x.settings();await x.m.check();x.time('23:10');await x.control('start');x.status['123']=1;x.status['124']=1;await x.m.check();assert.equal(x.sent.length,4);
 x.status['123']=0;await x.m.check();await x.m.check();assert.equal(x.m.snapshot().detection['123'],'outside_window');assert.equal(x.m.snapshot().detection['124'],'manual');
 x.status['124']=0;await x.m.check();await x.m.check();assert.equal(x.m.data.control,'auto');x.requests.length=0;await x.m.check();assert.equal(x.requests.length,0);
 await x.control('stop');await x.m.close();const m2=x.make();await m2.init();try{x.time('19:00');await m2.check();assert.equal(x.requests.length,0);assert.equal(m2.data.control,'stopped');}finally{await m2.close();}
});
test('请求途中停止检测使返回结果失效，恢复自动不会残留手动模式',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.m.check();x.status['123']=1;let release;x.hold(new Promise(r=>release=r));const p=x.m.check();await x.control('stop');release();await p;assert.equal(x.sent.length,0);await x.control('auto');assert.equal(x.m.data.control,'auto');
});
test('手动开播不访问 B站，后续自动检测同一次开播不重复发送，下播仍正常',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.m.check();x.requests.length=0;
 await x.notify('start');await x.drain();assert.equal(x.requests.length,0);assert.equal(x.sent.length,2);assert.equal(x.m.data.states['123'].phase,'offline');
 x.status['123']=1;await x.m.check();assert.equal(x.sent.length,2);x.status['123']=0;await x.m.check();await x.m.check();assert.equal(x.sent.length,4);assert(x.m.data.records.some(r=>r.source==='manual'));
});
test('手动下播不访问 B站，自动确认同一次下播后不重复通知',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.m.check();x.status['123']=1;await x.m.check();await x.notify('end');await x.drain();assert.equal(x.sent.length,4);
 x.status['123']=0;await x.m.check();await x.m.check();assert.equal(x.sent.length,4);
});
test('检测停止或关闭时仍可手动发通知，操作不会开启检测',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.control('stop');x.requests.length=0;await x.notify('end');await x.drain();assert.equal(x.m.data.control,'stopped');assert.equal(x.requests.length,0);
 await x.settings({enabled:false});await x.notify('start');await x.drain();assert.equal(x.m.data.enabled,false);assert.equal(x.requests.length,0);
});
test('失败记录只补发原群，沿用原通知文本，且不请求 B站',async t=>{
 const x=await fixture(t);await x.add();x.send(group=>{if(group==='111')throw Error('timeout');});await x.notify('start');await x.drain();const row=x.m.data.records.find(r=>r.status==='uncertain');assert.equal(row.group,'111');
 x.m.data.rooms['123'].title='新标题';x.send(null);x.requests.length=0;await x.notify('start',{recordId:row.id});await x.drain();assert.equal(x.sent.length,3);assert.equal(x.sent[2].group,'111');assert.equal(x.sent[2].text,row.text);assert.equal(x.requests.length,0);
 await assert.rejects(x.notify('start',{recordId:'bad'}));
});
test('同主播手动发送中的重复点击被拒绝，删除后剩余群不发送',async t=>{
 const x=await fixture(t);await x.add();let release,entered;const ready=new Promise(r=>entered=r);x.send(async()=>{entered();await new Promise(r=>release=r);});await x.notify('start');await ready;
 await assert.rejects(x.notify('start'),/正在发送/);await x.m.remove({uid:'123',revision:x.m.data.revision});release();await x.drain();assert.equal(x.sent.length,1);assert(x.m.data.records.some(r=>r.status==='cancelled'));
});
test('旧文件迁移默认全天检测且持续跟踪，缓存房间资料保留',async t=>{
 const x=await fixture(t);await x.add();const d=structuredClone(x.m.data);for(const k of [...Object.keys(scheduleDefaults),'rooms','manualNotices','manualTargets'])delete d[k];await fs.writeFile(x.m.file,JSON.stringify(d));const m2=x.make();await m2.init();try{assert.equal(m2.loadError,'');assert.equal(m2.data.scheduleEnabled,false);assert.equal(m2.data.continueUntilEnd,true);assert.equal(m2.data.rooms['123'].roomId,'1123');}finally{await m2.close();}
});
test('手动消息先持久化再发送，重启不自动重发未取得回执的手动通知',async t=>{
 const x=await fixture(t);await x.add();x.send(async group=>{const d=JSON.parse(await fs.readFile(x.m.file,'utf8'));assert(d.records.some(r=>r.group===group&&r.status==='attempting'&&r.source==='manual'));});await x.notify('start');await x.drain();
 const d=JSON.parse(await fs.readFile(x.m.file,'utf8'));d.records[0].status='queued';await fs.writeFile(x.m.file,JSON.stringify(d));const m2=x.make();await m2.init();try{assert.equal(m2.data.records[0].status,'uncertain');assert.equal(x.sent.length,2);}finally{await m2.close();}
});

test('手动补发的短时去重过期后不会吞掉后来的开播通知',async t=>{
 const x=await fixture(t);await x.add();await x.settings();await x.m.check();await x.notify('start');await x.drain();assert.equal(x.sent.length,2);
 x.time('20:00');x.status['123']=1;await x.m.check();assert.equal(x.sent.length,4);
});

test('多时段含跨午夜与重叠，边界取并集，下一次开始选择最近一段',()=>{
 const d=validateSchedule({...scheduleDefaults,scheduleEnabled:true,windows:[{startTime:'22:00',endTime:'02:00'},{startTime:'12:00',endTime:'14:00'},{startTime:'13:00',endTime:'15:00'}]});
 for(const h of ['00:00','01:59','12:00','13:00','14:00','14:59','22:00'])assert.equal(liveWindow(d,clock(h)).inside,true,h);
 for(const h of ['02:00','11:59','15:00','21:59'])assert.equal(liveWindow(d,clock(h)).inside,false,h);
 assert.equal(liveWindow(d,clock('02:00')).nextOpenAt,clock('12:00'));assert.equal(liveWindow(d,clock('15:00')).nextOpenAt,clock('22:00'));
 const daytime={...d,windows:[{startTime:'19:00',endTime:'20:00'},{startTime:'12:00',endTime:'14:00'}]};assert.equal(liveWindow(daytime,clock('23:59')).nextOpenAt,clock('12:00')+86400000);
});
test('重叠时段每轮仍只查一次，间隔空档不查，重启保留全部时段',async t=>{
 const x=await fixture(t);await x.add();const windows=[{startTime:'12:00',endTime:'14:00'},{startTime:'13:00',endTime:'15:00'},{startTime:'22:00',endTime:'02:00'}];await x.settings({windows});
 x.time('13:30');x.requests.length=0;await x.m.check();assert.deepEqual(x.requests,['123']);
 x.time('15:00');x.requests.length=0;await x.m.check();assert.deepEqual(x.requests,[]);LiveMonitor.prototype.schedule.call(x.m);assert.equal(x.m.nextCheckAt,clock('22:00'));
 x.time('00:30');await x.m.check();assert.deepEqual(x.requests,['123']);
 const m2=x.make();await m2.init();try{assert.equal(m2.loadError,'');assert.deepEqual(m2.snapshot().windows,windows);}finally{await m2.close();}
});
test('旧版单时段自动迁移；无效多时段保存不覆盖已有配置',async t=>{
 const x=await fixture(t);await x.add();await x.settings({startTime:'19:00',endTime:'23:30'});const old=JSON.parse(await fs.readFile(x.m.file,'utf8'));delete old.windows;await fs.writeFile(x.m.file,JSON.stringify(old));
 const m2=x.make();await m2.init();try{assert.equal(m2.loadError,'');assert.deepEqual(m2.snapshot().windows,[{startTime:'19:00',endTime:'23:30'}]);}finally{await m2.close();}
 const before=structuredClone(x.m.data);
 for(const windows of [null,{},[],[{startTime:'24:00',endTime:'12:00'}],[{startTime:'12:00',endTime:'12:00'}],Array(13).fill({startTime:'12:00',endTime:'13:00'})]){await assert.rejects(x.settings({windows}));assert.deepEqual(x.m.data,before);}
 await x.settings({scheduleEnabled:false,windows:[]});assert.deepEqual(x.m.snapshot().windows,[]);assert.equal(x.m.snapshot().window.inside,true);
});
test('手动通知日志包含收到、排队、逐群发送、成功与失败，失败不影响后续群',async t=>{
 const x=await fixture(t);await x.add();x.send(group=>{if(group==='111')throw Error('timeout');});await x.notify('start');await x.drain();
 const logs=x.logs.map(r=>r.message).join('\n');for(const marker of ['收到手动通知请求','已排队','正在发送','发送成功','发送异常'])assert(logs.includes(marker),marker);
 assert.equal(x.m.data.records.find(r=>r.group==='111').status,'uncertain');assert.equal(x.m.data.records.find(r=>r.group==='222').status,'sent');
});
