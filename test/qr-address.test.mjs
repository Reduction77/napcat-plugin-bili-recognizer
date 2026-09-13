import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QrLogin,qrContent,loginUrl,qrImage} from '../lib/login.mjs';
const json=data=>new Response(JSON.stringify({code:0,data}));
const urls=[
 'http://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=SECRET_KEY',
 'https://passport.bilibili.com/qrcode/h5/login?qrcode_key=SECRET_KEY',
 'https://passport.bilibili.com/#/passport/login?key=SECRET_KEY',
 'https://www.bilibili.com/blackboard/login.html?key=SECRET_KEY',
 'https://passport.biligame.com/login/scan?key=SECRET_KEY',
 // Synthetic response fixtures; these are not claims about Bilibili production hosts.
 'https://qr-fixture.example/login?key=SECRET_KEY',
 'https://QR-Fixture.example:443/a/../login?key=SECRET_KEY&sig=%2f%2B'
];
test('复现旧二维码校验误拒绝，并接受官方域的协议/路径变化',()=>{
 for(const url of urls){const old=loginUrl(url);assert(!(old&&old.hostname==='passport.bilibili.com'&&old.pathname.startsWith('/h5-app/passport/')));const fixed=qrContent(url);assert.equal(fixed.ok,true,url);assert.equal(fixed.url,url);}
 const oldUrl='https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=SECRET_KEY';assert.equal(qrContent(oldUrl).url,oldUrl);
});
test('二维码生成后可轮询并保存凭据，后端始终访问固定 HTTPS API',async()=>{
 for(const qrUrl of urls){const calls=[],traces=[],saved=[];const state={config:{cookie:''},onTrace:r=>traces.push(r)};
  const login=new QrLogin(()=>state,async cookie=>saved.push(cookie),async url=>{calls.push(url);return url.includes('/generate')?json({url:qrUrl,qrcode_key:'SECRET_KEY'}):json({code:0,url:'https://www.bilibili.com/?SESSDATA=SECRET_COOKIE&bili_jct=SECRET_CSRF&DedeUserID=123'});});
  try{const generated=await login.generate();assert.match(generated.image,/^data:image\/svg\+xml;base64,/);assert.equal((await login.poll(generated.sessionId)).state,'success');assert.equal(saved.length,1);assert.equal(generated.image,qrImage(qrUrl));assert.equal(calls.length,2);assert(calls.every(u=>u.startsWith('https://passport.bilibili.com/x/passport-login/web/qrcode/')));assert(!JSON.stringify(traces).includes('SECRET_KEY'));assert(!JSON.stringify(traces).includes('SECRET_COOKIE'));}
  finally{login.close();}
 }
});
test('危险协议及格式错误仍被拒绝，错误不泄露二维码密钥',async()=>{
 const cases=[['https://SECRET_KEY@passport.bilibili.com/','USERINFO_NOT_ALLOWED'],['https://passport.bilibili.com:8443/?key=SECRET_KEY','PORT_NOT_ALLOWED'],['javascript:SECRET_KEY','UNSUPPORTED_SCHEME'],['file:///SECRET_KEY','UNSUPPORTED_SCHEME'],['https://passport.bilibili.com/\nSECRET_KEY','INVALID_CHARACTERS'],['','MISSING_URL']];
 for(const [url,reason] of cases){const traces=[];const login=new QrLogin(()=>({config:{cookie:''},onTrace:r=>traces.push(r)}),async()=>assert.fail('不应保存账号'),async()=>json({url,qrcode_key:'SECRET_KEY'}));
  try{await assert.rejects(login.generate(),e=>e.code==='LOGIN_QR_URL'&&e.reason===reason);assert.equal(login.current,null);const error=traces.find(r=>r.phase==='ERROR');assert.equal(error.httpStatus,200);assert.equal(error.biliCode,0);assert.equal(error.validation,reason);assert(!JSON.stringify(traces).includes('SECRET_KEY'));}finally{login.close();}
 }
});
test('二维码内容兼容不放宽后端换票地址规则；残缺响应有明确错误',async()=>{
 assert(qrContent(urls[0]).ok);assert.equal(loginUrl(urls[0]),null);assert.equal(loginUrl('https://evil.example/crossDomain?ticket=x',true),null);
 for(const data of [{url:urls[0]},{url:urls[0],qrcode_key:123},{url:urls[0],qrcode_key:''}]){const login=new QrLogin(()=>({config:{cookie:''}}),async()=>{},async()=>json(data));try{await assert.rejects(login.generate(),{code:'LOGIN_FORMAT'});}finally{login.close();}}
});

test('固定接口的重定向响应即使包含成功 JSON 也不能提供二维码',async()=>{
 const calls=[];const login=new QrLogin(()=>({config:{cookie:''}}),async()=>assert.fail('不应保存'),async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'manual');
  return new Response(JSON.stringify({code:0,data:{url:urls[5],qrcode_key:'SECRET_KEY'}}),{status:302,headers:{location:'https://redirect-fixture.example/'}});
 });
 try{await assert.rejects(login.generate(),{code:'302'});assert.equal(calls.length,1);assert.equal(login.current,null);}finally{login.close();}
});
test('二维码内容不会成为换票请求目标，也不会收到 Cookie',async()=>{
 const calls=[];const login=new QrLogin(()=>({config:{cookie:''}}),async()=>assert.fail('不应保存'),async url=>{
  calls.push(url);return url.includes('/generate')?json({url:urls[5],qrcode_key:'SECRET_KEY'}):json({code:0,url:'https://qr-fixture.example/crossDomain?ticket=SECRET_TICKET'});
 });
 try{const q=await login.generate();await assert.rejects(login.poll(q.sessionId),{code:'LOGIN_COOKIES'});assert.equal(calls.length,2);assert(calls.every(u=>new URL(u).hostname==='passport.bilibili.com'));assert.equal(loginUrl(urls[5]),null);}finally{login.close();}
});
