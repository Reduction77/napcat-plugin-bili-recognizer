import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QrLogin,exchangeUrl,loginUrl} from '../lib/login.mjs';
import {CookieJar} from '../lib/cookies.mjs';
import {traceLine} from '../lib/trace.mjs';
const json=(data,headers)=>new Response(JSON.stringify({code:0,data}),{headers});
const credentials=['SESSDATA=NEW_SESSION_SECRET','bili_jct=NEW_CSRF_SECRET','DedeUserID=12345'];
function headers(values=credentials,location){const h=new Headers();for(const c of values)h.append('Set-Cookie',c+'; Domain=.bilibili.com; Path=/; Secure; HttpOnly');if(location)h.set('Location',location);return h;}
function fixture(t,responder){
 const jar=new CookieJar();jar.importLegacy('SESSDATA=OLD_SESSION_SECRET; bili_jct=OLD_CSRF_SECRET; DedeUserID=67890; buvid3=DEVICE_SECRET');
 const state={config:{cookie:'SESSDATA=OLD_SESSION_SECRET'},client:{jar},onTrace:r=>traces.push(r)},saved=[],calls=[],traces=[];
 const login=new QrLogin(()=>state,async(cookie,expected,valid,snapshot)=>{assert(valid());saved.push({cookie,snapshot});},async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'manual');assert(!String(options.headers.Cookie||'').includes('OLD_SESSION_SECRET'));
  if(url.includes('/generate'))return json({url:'https://qr-fixture.example/?key=QR_SECRET',qrcode_key:'QR_SECRET'});
  return responder(url,options);
 });t.after(()=>login.close());return {login,saved,calls,traces};
}
test('复现 crossDomain 302 已下发完整 Cookie，却被落地页校验误报失败',async t=>{
 for(const location of ['http://landing-fixture.example/SECRET_TICKET','https://landing-fixture.example/SECRET_TICKET','https://[invalid']){
  const f=fixture(t,url=>url.includes('/poll')?json({code:0,url:'https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=SECRET_TICKET',refresh_token:'REFRESH_SECRET'}):new Response(null,{status:302,headers:headers(credentials,location)}));
  const q=await f.login.generate();assert.equal((await f.login.poll(q.sessionId)).state,'success');assert.equal(f.calls.length,3);assert.equal(f.saved.length,1);assert.match(f.saved[0].cookie,/SESSDATA=NEW_SESSION_SECRET/);assert.equal(f.saved[0].snapshot.refreshToken,'REFRESH_SECRET');
  const diagnostic=JSON.stringify(f.traces)+f.traces.map(traceLine).join('\n');for(const secret of ['NEW_SESSION_SECRET','NEW_CSRF_SECRET','SECRET_TICKET','QR_SECRET','REFRESH_SECRET'])assert(!diagnostic.includes(secret));
 }
});
test('HTTP 换票地址与跳转均升级为 HTTPS，逐跳合并 Cookie 且隔离游戏域',async t=>{
 const f=fixture(t,(url,options)=>{
  assert(url.startsWith('https://'));
  if(url.includes('/poll'))return json({code:0,url:'http://passport.bilibili.com/crossDomain?ticket=first'});
  if(url.includes('ticket=first'))return new Response(null,{status:302,headers:headers(credentials.slice(0,1),'http://passport.biligame.com/crossDomain?ticket=second')});
  if(url.includes('passport.biligame.com')){assert(!options.headers.Cookie);return new Response(null,{status:302,headers:{Location:'//passport.bilibili.com/crossDomain?ticket=last','Set-Cookie':'SESSDATA=GAME_SESSION_SECRET; Domain=.biligame.com; Path=/; Secure'}});}
  assert(!options.headers.Cookie.includes('GAME_SESSION_SECRET'));assert(options.headers.Cookie.includes('NEW_SESSION_SECRET'));
  return new Response(null,{status:302,headers:headers(credentials.slice(1),'http://landing-fixture.example/')});
 });const q=await f.login.generate();assert.equal((await f.login.poll(q.sessionId)).state,'success');assert.equal(f.calls.length,5);assert(!f.saved[0].cookie.includes('GAME_SESSION_SECRET'));
});
test('旧版 HTTP 返回 URL 中的凭据可直接提取，保留 SESSDATA 逗号编码',async t=>{
 const f=fixture(t,()=>json({code:0,url:'http://www.bilibili.com/?SESSDATA=one%2Ctwo&bili_jct=NEW_CSRF_SECRET&DedeUserID=12345'}));
 const q=await f.login.generate();assert.equal((await f.login.poll(q.sessionId)).state,'success');assert.equal(f.calls.length,2);assert.match(f.saved[0].cookie,/SESSDATA=one%2Ctwo/);
});
test('poll 已下发完整凭据时不再访问多余的 crossDomain',async t=>{
 const f=fixture(t,url=>{assert(url.includes('/poll'));return json({code:0,url:'https://passport.bilibili.com/crossDomain?ticket=unused'},headers());});
 const q=await f.login.generate();assert.equal((await f.login.poll(q.sessionId)).state,'success');assert.equal(f.calls.length,2);
});
test('凭据不完整时拒绝陌生跳转，不覆盖账号并记录缺少的 Cookie 名称',async t=>{
 const f=fixture(t,url=>url.includes('/poll')?json({code:0,url:'https://passport.bilibili.com/crossDomain?ticket=SECRET_TICKET'}):new Response(null,{status:302,headers:headers(credentials.slice(0,1),'https://untrusted-fixture.example/SECRET_TICKET')}));
 const q=await f.login.generate();await assert.rejects(f.login.poll(q.sessionId),{code:'LOGIN_URL'});assert.equal(f.saved.length,0);assert.equal(f.calls.length,3);
 const diagnostic=f.traces.find(r=>r.phase==='ERROR'&&r.error==='LOGIN_URL');assert.equal(diagnostic?.httpStatus,302);assert.deepEqual(diagnostic.missingCookies,['bili_jct','DedeUserID']);assert(!JSON.stringify(f.traces).includes('SECRET_TICKET'));
});
test('换票循环有次数上限，残缺凭据不会保存',async t=>{
 let hop=0;const f=fixture(t,url=>url.includes('/poll')?json({code:0,url:'https://passport.bilibili.com/crossDomain?ticket=0'}):new Response(null,{status:302,headers:{location:'https://passport.bilibili.com/crossDomain?ticket='+ ++hop}}));
 const q=await f.login.generate();await assert.rejects(f.login.poll(q.sessionId),{code:'LOGIN_REDIRECT_LIMIT'});assert.equal(f.saved.length,0);assert(f.calls.length<=12);
});
test('跨域换票期间取消登录，迟到的完整凭据不得保存',async t=>{
 let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const f=fixture(t,url=>url.includes('/poll')?json({code:0,url:'https://passport.bilibili.com/crossDomain?ticket=1'}):(entered(),pending));
 const q=await f.login.generate();const poll=f.login.poll(q.sessionId);await ready;f.login.cancel();release(new Response(null,{status:302,headers:headers(credentials,'http://landing-fixture.example/')}));
 await assert.rejects(poll,{code:'LOGIN_SESSION'});assert.equal(f.saved.length,0);
});

test('HTTP 转 HTTPS 不放宽域名、端口、用户信息与协议限制',()=>{
 for(const url of ['http://passport.bilibili.com.evil.example/crossDomain?ticket=x','http://127.0.0.1/crossDomain?ticket=x','http://passport.bilibili.com:8080/crossDomain?ticket=x','http://secret@passport.bilibili.com/crossDomain?ticket=x','javascript:secret','file:///secret'])assert.equal(exchangeUrl(url),null);
 assert.equal(loginUrl('http://passport.bilibili.com/crossDomain?ticket=x'),null);
 assert.equal(exchangeUrl('/crossDomain?ticket=x','https://passport.bilibili.com/').href,'https://passport.bilibili.com/crossDomain?ticket=x');
});
