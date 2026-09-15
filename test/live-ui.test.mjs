import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=(await fs.readFile(new URL('../webui/app.js',import.meta.url),'utf8')).replace("navigate('status');",'');
const fixture=()=>({revision:2,enabled:true,intervalSeconds:60,subscriptions:[{uid:'123',label:'<img onerror=bad>',groups:['111'],start:true,end:true,enabled:true}],states:{'123':{name:'主播',roomId:'456',title:'<script>bad</script>',status:1,startAt:0,checkedAt:1000}},records:[],nextCheckAt:0,windows:[{startTime:'18:00',endTime:'23:00'}]});
function setup(){
 const nodes=new Map(),listeners={},intervals=[],requests=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',checked:false,disabled:false,hidden:false,classList:{toggle(){}},setAttribute(){}});return nodes.get(id);};
 const context=vm.createContext({console,URL,AbortSignal,Set,window:{BILI_BASE:'/api/Plugin/ext/bili',addEventListener(){}},document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener:(e,fn)=>(listeners[e]??=[]).push(fn),body:{classList:{add(){}}}},localStorage:{getItem:()=> 'light'},setInterval:fn=>intervals.push(fn),setTimeout:()=>1,clearTimeout(){},confirm:()=>true,fetch:async(url,o)=>{requests.push({url,card:url.endsWith('/live/card'),body:o.body&&JSON.parse(o.body)});return {ok:true,status:200,json:async()=>({code:0,data:fixture()})};}});
 vm.runInContext(source,context);context.fixture=fixture();vm.runInContext("page='live';renderLive(fixture)",context);
 const business=()=>requests.filter(r=>!r.card);
 return {context,node,listeners,intervals,requests,business};
}
test('直播页面提供设置、订阅和发送记录，并转义主播昵称及标题',()=>{
 const x=setup();assert.match(x.node('#content').innerHTML,/live-settings-form/);assert.match(x.node('#content').innerHTML,/live-subscription-form/);assert.match(x.node('#content').innerHTML,/连续两次/);
 const rows=x.node('#live-subscriptions').innerHTML;assert(!rows.includes('<script>'));assert(!rows.includes('<img'));assert(rows.includes('&lt;script&gt;'));assert(rows.includes('直播中'));
 x.context.fixture.states['123'].stopHits=1;vm.runInContext('renderLiveRows(fixture)',x.context);assert.match(x.node('#live-subscriptions').innerHTML,/等待确认/);
});
test('直播设置提交到鉴权 API，保存时保留另一个未保存表单',async()=>{
 const x=setup();x.node('#live-enabled').checked=true;x.node('#live-interval').value='90';x.node('#live-window-enabled').checked=true;x.node('#live-window-start-0').value='22:00';x.node('#live-window-end-0').value='02:00';x.node('#live-follow').checked=true;
 vm.runInContext("liveDirty.add('live-settings-form');liveDirty.add('live-subscription-form');dirty=true",x.context);
 const original=x.node('#content').innerHTML,button={disabled:false},form={id:'live-settings-form',querySelector:()=>button};
 for(const fn of x.listeners.submit)await fn({target:form,preventDefault(){}});
 assert.equal(x.business()[0].url,'/api/Plugin/ext/bili/live/settings');assert.deepEqual(x.business()[0].body,{revision:2,enabled:true,intervalSeconds:90,scheduleEnabled:true,windows:[{startTime:'22:00',endTime:'02:00'}],continueUntilEnd:true});
 assert.equal(x.node('#content').innerHTML,original);assert.equal(vm.runInContext('dirty',x.context),true);assert.equal(button.disabled,false);
});
test('后台刷新状态不覆盖表单，也不提升表单版本从而绕过并发冲突检查',async()=>{
 const x=setup();const original=x.node('#content').innerHTML;
 x.context.fetch=async()=>({ok:true,status:200,json:async()=>({code:0,data:{...fixture(),revision:99}})});
 for(const fn of x.intervals)await fn();assert.equal(x.node('#content').innerHTML,original);assert.equal(vm.runInContext('liveData.revision',x.context),2);
});

test('手动开始、停止、恢复按钮调用对应控制接口',async()=>{
 for(const action of ['start','stop','auto']){const x=setup();const b={id:'live-detect-'+action,dataset:{},disabled:false,classList:{contains:()=>false}};
  for(const fn of x.listeners.click)await fn({target:{closest:()=>b}});
  assert.equal(x.business().length,1);assert.equal(x.business()[0].url,'/api/Plugin/ext/bili/live/control');assert.deepEqual(x.business()[0].body,{revision:2,action});
 }
});
async function click(x,id='',dataset={},cls=''){
 const b={id,dataset,disabled:false,classList:{contains:k=>k===cls}};
 for(const fn of x.listeners.click)await fn({target:{closest:()=>b}});
}
test('浏览器禁止原生确认框时，开播和下播仍可经页内确认提交；取消不发送',async()=>{
 for(const kind of ['start','end']){
  const x=setup();x.context.confirm=()=>{throw Error('原生弹窗被 iframe 限制');};
  await click(x,'',{uid:'123',kind},'live-manual-notify');assert.equal(x.business().length,0);
  assert.equal(x.node('#live-manual-panel').hidden,false);assert.match(x.node('#live-manual-panel').innerHTML,/目标群：111/);assert(!x.node('#live-manual-panel').innerHTML.includes('<img'));
  await click(x,'live-manual-cancel');assert.equal(x.business().length,0);assert.equal(x.node('#live-manual-panel').hidden,true);
  await click(x,'',{uid:'123',kind},'live-manual-notify');await click(x,'live-manual-send');
  assert.equal(x.business().length,1);assert.equal(x.business()[0].url,'/api/Plugin/ext/bili/live/notify');assert.deepEqual(x.business()[0].body,{revision:2,uid:'123',kind});assert.match(x.node('#live-action-status').textContent,/已排队/);
 }
});
test('单群补发确认显示原群并传递原记录；刷新保留确认内容和对应版本',async()=>{
 const x=setup();x.context.fixture.records=[{id:'record-1',uid:'123',group:'111',kind:'end',status:'uncertain'}];vm.runInContext('renderLiveRows(fixture)',x.context);
 await click(x,'',{uid:'123',kind:'end',record:'record-1'},'live-manual-notify');const panel=x.node('#live-manual-panel').innerHTML;
 x.context.fixture.revision=99;x.context.fixture.subscriptions[0].groups=['222'];vm.runInContext('renderLiveRows(fixture)',x.context);
 assert.equal(x.node('#live-manual-panel').innerHTML,panel);assert.match(panel,/目标群：111/);assert.match(panel,/仅补发/);
 await click(x,'live-manual-send');assert.deepEqual(x.business()[0].body,{revision:2,uid:'123',kind:'end',recordId:'record-1'});
});
test('提交失败留在页内显示原因，清除发送意图且不会自动重发',async()=>{
 const x=setup();await click(x,'',{uid:'123',kind:'start'},'live-manual-notify');
 x.context.fetch=async()=>{throw Error('网络中断');};await click(x,'live-manual-send');
 assert.match(x.node('#live-action-status').textContent,/网络中断/);assert.match(x.node('#live-action-status').textContent,/检查群消息/);assert.equal(x.node('#live-manual-panel').hidden,true);assert.equal(vm.runInContext('manualIntent',x.context),null);assert.equal(vm.runInContext('busy',x.context),false);
});
test('未保存表单阻止手动发送时提供持续可见反馈，重复点击不会重复提交',async()=>{
 const x=setup();vm.runInContext('dirty=true',x.context);await click(x,'',{uid:'123',kind:'start'},'live-manual-notify');assert.equal(x.business().length,0);assert.equal(x.node('#live-action-status').hidden,false);assert.match(x.node('#live-action-status').textContent,/未保存/);
 vm.runInContext('dirty=false',x.context);await click(x,'',{uid:'123',kind:'start'},'live-manual-notify');
 let release,calls=0;x.context.fetch=async()=>{calls++;await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>({code:0,data:fixture()})};};
 const first=click(x,'live-manual-send');while(!release)await Promise.resolve();await click(x,'live-manual-send');assert.equal(calls,1);release();await first;
});
test('增删时段保留尚未保存的时间，保存一次提交全部时段',async()=>{
 const x=setup();x.node('#live-window-start-0').value='12:00';x.node('#live-window-end-0').value='14:00';
 await click(x,'live-window-add');assert.match(x.node('#live-window-list').innerHTML,/value="12:00"/);assert.match(x.node('#live-window-list').innerHTML,/live-window-start-1/);assert.equal(vm.runInContext('dirty',x.context),true);
 x.node('#live-window-start-1').value='22:00';x.node('#live-window-end-1').value='02:00';
 const button={disabled:false};for(const fn of x.listeners.submit)await fn({target:{id:'live-settings-form',querySelector:()=>button},preventDefault(){}});
 assert.deepEqual(x.business()[0].body.windows,[{startTime:'12:00',endTime:'14:00'},{startTime:'22:00',endTime:'02:00'}]);
 await click(x,'live-window-remove-0');assert.match(x.node('#live-window-list').innerHTML,/value="22:00"/);assert(!x.node('#live-window-list').innerHTML.includes('live-window-start-1'));
});
