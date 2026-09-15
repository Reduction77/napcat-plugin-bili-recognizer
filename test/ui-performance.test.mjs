import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness,liveFixture} from './helpers/ui-harness.mjs';
test('未变化的直播列表不重绘，状态和结果改变分别更新，表单保留',async()=>{
 const x=await uiHarness();x.context.d=liveFixture();x.eval("page='live';renderLive(d)");const content=x.node('#content').innerHTML,subs=x.writes.get('#live-subscriptions'),records=x.writes.get('#live-records');
 for(let i=0;i<20;i++)x.eval('renderLiveRows(d)');assert.equal(x.writes.get('#live-subscriptions'),subs);assert.equal(x.writes.get('#live-records'),records);
 x.context.d.states['100'].status=1;x.eval('renderLiveRows(d)');assert.equal(x.writes.get('#live-subscriptions'),subs+1);assert.equal(x.writes.get('#live-records'),records);assert.equal(x.node('#content').innerHTML,content);
 x.context.d.records[0].status='uncertain';x.eval('renderLiveRows(d)');assert.equal(x.writes.get('#live-records'),records+1);assert.match(x.node('#live-records').innerHTML,/仅补发此群/);x.eval('renderLive(d)');assert.match(x.node('#live-subscriptions').innerHTML,/主播0/);
});
test('空闲页面一分钟四次轮询，任务执行时五秒一次，隐藏时零请求',async()=>{
 const x=await uiHarness();x.context.d=liveFixture();x.eval("page='live';renderLive(d)");for(let i=0;i<12;i++)await x.tick(5000);assert.equal(x.polling().length,4);
 x.requests.length=0;x.context.document.hidden=true;for(let i=0;i<12;i++)await x.tick(5000);assert.equal(x.polling().length,0);
 x.context.document.hidden=false;x.context.fetch=async()=>{x.requests.push({});return {ok:true,status:200,json:async()=>({code:0,data:{...liveFixture(),manualSending:['100']}})};};x.eval('nextRefreshAt=0');for(let i=0;i<12;i++)await x.tick(5000);assert.equal(x.requests.length,12);
});
test('失败逐步退避，成功恢复刷新；慢请求不会并发堆积',async()=>{
 const x=await uiHarness();x.eval("page='live'");let calls=0;x.context.fetch=async()=>{calls++;throw Error('断线');};await x.tick(0);await x.tick(10000);assert.equal(calls,1);await x.tick(5000);assert.equal(calls,2);await x.tick(25000);assert.equal(calls,2);await x.tick(5000);assert.equal(calls,3);
 let release;x.context.fetch=async()=>{calls++;await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>({code:0,data:liveFixture()})};};const pending=x.tick(60000);await Promise.resolve();await x.tick(5000);assert.equal(calls,4);release();await pending;assert.equal(x.eval('refreshFailures'),0);x.context.fetch=async()=>({ok:true,status:200,json:async()=>({code:0,data:liveFixture()})});await x.tick(15000);assert.equal(x.eval('refreshFailures'),0);
});
test('切页后的旧请求不重绘新页，不把旧失败带到新页面',async()=>{
 const x=await uiHarness();x.eval("page='live'");let reject;x.context.fetch=()=>new Promise((_,r)=>reject=r);const pending=x.tick(0);await Promise.resolve();x.eval("page='logs';epoch++;nextRefreshAt=0;refreshFailures=0");reject(Error('旧请求超时'));await pending;assert.equal(x.eval('refreshFailures'),0);assert.equal(x.eval('nextRefreshAt'),0);
});
test('诊断只轮询摘要，未变化的日志、记录、诊断和下载不重绘，传输按钮不会被刷新启用',async()=>{
 const x=await uiHarness();x.context.fetch=async url=>{x.requests.push({url});return {ok:true,status:200,json:async()=>({code:0,data:{report:null}})};};x.eval("page='account'");await x.tick(0);assert.equal(x.requests[0].url,'/bili/diagnostics/summary');
 x.context.rows=[{time:1000,title:'视频',type:'video',outcome:'success',source:'group',duration:10}];x.eval("records=rows;renderRecords();logRows=[{time:1000,level:'info',message:'test'}];renderLogs()");const a=x.writes.get('#record-table'),b=x.writes.get('#log-list'),c=x.writes.get('#diagnosis-result');x.eval('renderRecords();renderLogs();renderDiagnosis()');assert.equal(x.writes.get('#record-table'),a);assert.equal(x.writes.get('#log-list'),b);assert.equal(x.writes.get('#diagnosis-result'),c);
 x.context.jobs={jobs:[{id:'job1',title:'视频',createdAt:1000,page:1,status:'done',fileReady:true,bytes:1234,quality:32}],risk:{}};x.eval('renderJobs(jobs);renderJobs(jobs)');assert.equal(x.writes.get('#download-jobs'),1);x.eval("savingVideos.add('job1');renderJobs(jobs)");assert.match(x.node('#download-jobs').innerHTML,/disabled>正在传输/);
});
test('运行时间更新不重建概览整页，统计改变才重绘',async()=>{
 const x=await uiHarness();x.context.s={uptime:6000,enabled:true,stats:{success:1,failed:0,tests:0,testFailed:0},cacheCount:0,version:'test'};x.eval('status=s;records=[];renderStatus()');const n=x.writes.get('#content');x.context.s.uptime=21000;x.eval('renderStatus()');assert.equal(x.writes.get('#content'),n);assert.match(x.node('#status-uptime').textContent,/21 秒/);x.context.s.stats.success++;x.eval('renderStatus()');assert.equal(x.writes.get('#content'),n+1);
});
