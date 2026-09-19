import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {BiliClient} from '../lib/bili.mjs';
import {defaults} from '../lib/config.mjs';
import {selectStreams} from '../lib/downloads.mjs';
import {registerWebUI} from '../lib/webui.mjs';
const BV='BV1xx411c7mD';
const video=id=>({id,codecid:7,baseUrl:`https://cdn.bilivideo.com/v${id}`});
const audio={codecs:'mp4a.40.2',baseUrl:'https://cdn.bilivideo.com/audio'};
const dash={quality:80,dash:{video:[video(80),video(16),video(32)],audio:[audio]}};
test('480P 请求 DASH，按 id=32 选流；WBI 与旧接口均保留 qn',async()=>{
 for(const playurlMode of ['wbi','legacy']){
  const requests=[];const c=new BiliClient({...defaults,playurlMode,cookie:''},async url=>{
   const u=new URL(url);requests.push(u);
   if(u.pathname.endsWith('/nav'))return new Response(JSON.stringify({code:0,data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}}));
   const data=Number(u.searchParams.get('fnval'))&16?dash:{quality:16,durl:[{url:'https://cdn.bilivideo.com/360'}]};
   return new Response(JSON.stringify({code:0,data}));
  });try{
   const d=await c.playInfo(BV,1,32),q=requests.find(u=>u.pathname.endsWith('/playurl'));
   assert.equal(q.searchParams.get('qn'),'32');assert(Number(q.searchParams.get('fnval'))&16);assert.equal(selectStreams(d,32).quality,32);
   if(playurlMode==='wbi')assert(q.searchParams.has('w_rid'));
   await c.playInfo(BV,1,16);assert.equal(requests.at(-1).searchParams.get('fnval'),'1');
  }finally{c.close();}
 }
});
test('实际质量从视频轨获取，优先 DASH，严格遵守上限并排除 HEVC',()=>{
 const d={...dash,durl:[{url:'https://cdn.bilivideo.com/360'}]};assert.equal(selectStreams(d,32).quality,32);assert.equal(selectStreams(d,32).kind,'dash');
 assert.equal(selectStreams({dash:{video:[{id:32,codecid:12},video(16)],audio:[audio]}},32).quality,16);
 assert.throws(()=>selectStreams({quality:80,durl:[{url:'https://cdn.bilivideo.com/1080'}]},32),{code:'QUALITY'});
 assert.equal(selectStreams({durl:[{url:'https://cdn.bilivideo.com/unknown'}]},32).quality,null);
});
test('下载错误详情直接展示阶段、原因、字节数和导出入口，并转义 HTML',async()=>{
 const context={window:{}};vm.runInNewContext(await fs.readFile(new URL('../webui/download-details.js',import.meta.url),'utf8'),context);
 const ui=context.window.BiliDownloadDetails;
 const html=ui.render({id:'abc',error:'failed',failure:{stage:'read_body',causeCode:'ECONNRESET',httpStatus:200,host:'<script>alert(1)</script>',receivedBytes:4194304,attempt:1}},true);
 assert.match(html,/<summary>错误详情<\/summary>/);assert(html.includes('读取视频数据'));assert(html.includes('4194304'));assert(html.includes('ECONNRESET'));assert(html.includes('导出此任务诊断'));assert(!html.includes('<script>'));assert(html.includes(' open'));
 assert.equal(ui.quality(32),'480P');assert.match(ui.render({id:'old',error:'旧错误'}),/这条旧任务没有详细记录/);
});
test('页面先加载详情组件，再加载 app，支持带前缀的 NapCat 地址',async()=>{
 const html=await fs.readFile(new URL('../webui/index.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];const appended=[],listeners={};
 vm.runInNewContext(script,{window:{},location:{pathname:'/prefix/plugin/bili/dashboard'},document:{createElement:tag=>({tag}),head:{append:e=>appended.push(e)},addEventListener:(event,fn)=>listeners[event]=fn}});
 listeners.DOMContentLoaded();const helper=appended.at(-1);assert.equal(helper.src,'/prefix/plugin/bili/files/static/download-details.js?v=1.6.2');assert(!appended.some(e=>e.src?.includes('/app.js')));helper.onload();assert.match(appended.at(-1).src,/app.js\?v=1.6.2$/);
});
test('单任务诊断走鉴权路由，按任务隔离，不要求先运行账号自检',async()=>{
 const routes=new Map(),state={downloads:{list:()=>[{id:'a',failure:{causeCode:'ECONNRESET'}}]},traces:[{jobId:'a',phase:'ERROR'},{jobId:'b',phase:'ERROR'}]};
 registerWebUI({router:{static(){},page(){},get:(p,f)=>routes.set(p,f),post(){}}},()=>state,()=>{},()=>{});
 let result,status;const res={setHeader(){},status:s=>{status=s;return res;},json:x=>{result=x;}};
 await routes.get('/downloads/diagnostic/:id')({params:{id:'a'}},res);assert.equal(result.code,0);assert.equal(result.data.job.id,'a');assert.equal(result.data.traces.length,1);assert.equal(result.data.traces[0].jobId,'a');
 await routes.get('/downloads/diagnostic/:id')({params:{id:'missing'}},res);assert.equal(status,404);
});
