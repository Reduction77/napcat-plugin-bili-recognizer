// 直播通知卡片：文案（爱弥斯人设）、HTML 模板与外部文转图渲染。
//
// 人设依据（公开资料，2026-09 查证）：
//   《鸣潮》五星共鸣者爱弥斯，拉海洛「星炬学院」学生、隧者适格者，
//   失去肉身后成为无人可见的「电子幽灵」；共鸣能力「长航的星辉」，
//   显化「隧者兵装」变身为机兵形态。官方性格描述：活泼俏皮、喜爱分享快乐。
//   官方原句：「她轻盈地化作星辉，轻歌着于无尽的夜色中飞行，点亮黑暗中的群星。」
// 因此文案只用：校园感、星辉／夜色／飞行／点亮星星、隧者与适格者身份、电子感（信号／连接）。
// 不使用她剧情里失去肉身、告别一类的悲剧向内容。
import path from 'node:path';
import {qrImage} from './login.mjs';

// 保留 1.4.x 的纯文本格式，供 plain 人设、手动补发与降级使用。
export function liveMessage(sub,state,kind,now){
 const lines=[`【B站${kind==='start'?'开播':'下播'}通知】${sub.label||state.name}`,state.title?`直播间：${state.title}`:''];
 if(kind==='end'&&state.startAt>0&&state.startAt<now){const mins=Math.floor((now-state.startAt)/60000);lines.push(`本场直播时长约 ${Math.floor(mins/60)} 小时 ${mins%60} 分钟（按检测时间估算）`);}
 lines.push(`https://live.bilibili.com/${state.roomId}`);return lines.filter(Boolean).join('\n');
}

// 外部数据只在这里落地：去掉控制字符并限长。标题里的换行转成空格，避免卡片被撑破。
const tidy=(value,max)=>{const text=String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g,'').replace(/[ \t]+/g,' ').trim();return text.length>max?text.slice(0,max-1)+'…':text;};
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const safeImageUrl=value=>{try{const u=new URL(String(value??''));return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='hdslb.com'||u.hostname.endsWith('.hdslb.com'))?u.href:'';}catch{return '';}};
export const roomUrl=roomId=>`https://live.bilibili.com/${String(roomId||'').replace(/\D/g,'').slice(0,16)}`;
export function durationText(startAt,now){
 if(!(startAt>0)||!(now>startAt))return null;
 const mins=Math.floor((now-startAt)/60000);
 if(mins<1)return '不到 1 分钟（按检测时间估算）';
 return `${Math.floor(mins/60)} 小时 ${mins%60} 分钟（按检测时间估算）`;
}
// 北京时间（UTC+8）的 MM-DD HH:mm，与数据文件里的 UTC 时间戳无关，展示统一按北京时间。
export function clockText(time){
 const d=new Date(Number(time)||0);if(!Number.isFinite(d.getTime()))return '';
 const bj=new Date(d.getTime()+8*3600000);
 return `${String(bj.getUTCMonth()+1).padStart(2,'0')}-${String(bj.getUTCDate()).padStart(2,'0')} ${String(bj.getUTCHours()).padStart(2,'0')}:${String(bj.getUTCMinutes()).padStart(2,'0')}`;
}

// 人设：lines 的第一行是卡片标题，其余是卡片上的短句。
const personaReply=({kind,name,titleText,timeText,area,duration,url})=>{
 // 链接放在正文里，QQ 客户端会自动识别成可点击的链接；下播也给链接，方便回看。
 if(kind!=='start'){
  const head=duration?`「${name}」陪你播了 ${duration}`:`「${name}」下播咯`;
  const tail=[titleText?`《${titleText}》就先到这里`:''].filter(Boolean).join('，');
  return `${tail?`${head}，${tail}，辛苦啦！`:`${head}，辛苦啦！`}${url?`\n${url}`:''}`;
 }
 const watch=titleText?`《${titleText}》`:'直播间';
 const line=`「${name}」正在直播${watch}${area?` · ${area}`:''}${timeText?`，${timeText}已经开播啦`:''}`;
 // 开播通知前面加一个醒目的可点击入口，正文里也保留完整链接。
 return url?`🔴 正在直播 → ${url}\n${line}`:line;
};
const PERSONAS={
 amis:{
  label:'爱弥斯 · 活泼俏皮',
  start:({name,timeText,area})=>({lines:['💙 爱弥斯上线啦！',`「${name}」的直播间亮起来咯～我已经蹲在门口等同学你啦！`],meta:[timeText&&`⏰ ${timeText} 起飞`,area]}),
  end:({name,duration})=>({lines:['🌙 爱弥斯下播啦，今晚的星光就到这里～',duration?`「${name}」陪你唠了 ${duration}，辛苦啦！`:`「${name}」下播咯，辛苦啦！`],meta:['🛏️ 我也回拉海洛充电咯，明天记得还来哦！']}),
 },
 soft:{
  label:'软萌 · 轻声细语',
  start:({name,timeText,area})=>({lines:['💙 爱弥斯上线了～',`「${name}」开播啦，我在直播间等你…`],meta:[timeText&&`⏰ ${timeText} 开始`,area]}),
  end:({name,duration})=>({lines:['🌙 爱弥斯下播了～',duration?`「${name}」今天播了 ${duration}…`:`「${name}」今天辛苦了…`],meta:['✨ 明天见哦～']}),
 },
 plain:{
  label:'朴素 · 沿用原格式',
  start:({name,titleText,room})=>({lines:[`【B站开播通知】${name}`,titleText?`直播间：${titleText}`:'',`${room}`].filter(Boolean),meta:[]}),
  end:({name,titleText,room,duration})=>({lines:[`【B站下播通知】${name}`,titleText?`直播间：${titleText}`:'',duration?`本场直播时长约 ${duration}`:'',`${room}`].filter(Boolean),meta:[]}),
 },
};
export const personas=Object.keys(PERSONAS);
export function personaLabel(key){return PERSONAS[key]?.label||PERSONAS.amis.label;}

// 纯函数：把一次直播状态变化整理成文案 + 卡片数据。任何风格下主播名、标题、时间、链接都不丢。
export function liveCardData(sub,state,kind,now,{persona='amis'}={}){
 const style=PERSONAS[persona]?persona:'amis';
 const name=tidy(sub.label||state.name,40)||`UID ${state.uid||''}`.trim();
 const titleText=tidy(state.title,60);
 const area=tidy(state.areaName||state.area,20);
 const room=roomUrl(state.roomId);
 const duration=kind==='end'?durationText(state.startAt,now):null;
 const timeText=clockText(kind==='start'?(state.startAt||now):now);
 const built=PERSONAS[style][kind==='start'?'start':'end']({name,titleText,timeText,area,duration,room});
 const reply=personaReply({kind,name,titleText,timeText,area,duration,url:room});
 const text=liveMessage(sub,state,kind,now);
 const meta=built.meta.filter(Boolean).map(line=>String(line));
 // plain 人设不画卡片：调用方据此退回纯文本。
 const lines=built.lines.filter(Boolean);
 return {persona:style,name,kind,title:titleText,room,url:room,area,duration,timeText,meta,lines,reply,text,card:style!=='plain',summary:lines.join(' ')};
}

// —— HTML 模板 ——
// 所有外部数据在拼进 HTML 前都必须 escapeHtml；图片只接受 https 的 B站图床地址或本地贴纸 data URI。
const escapeAttr=value=>escapeHtml(value).replace(/\r?\n/g,' ');
const stickerTags=(list,kind)=>list.filter(Boolean).map((src,index)=>`<img class="sticker sticker-${kind}" src="${escapeAttr(src)}" style="--i:${index}" alt="">`).join('');
export function renderCardHtml(card,{theme='amis',stickers={}}={}){
 const cover=card.cover?`<img class="cover-img" src="${escapeAttr(card.cover)}" alt="">`:'<div class="cover-img cover-empty">本次没有取到封面，先看标题吧～</div>';
 const avatar=card.avatar?`<img class="avatar-img" src="${escapeAttr(card.avatar)}" alt="">`:'<div class="avatar-img avatar-empty">爱</div>';
 const qr=card.qr?`<img class="qr-img" src="${escapeAttr(card.qr)}" alt="直播间二维码">`:'';
 const durationRow=card.duration?`<div class="row"><span class="k">⏱</span><span class="v">本场 ${escapeHtml(card.duration)}</span></div>`:'';
 const metaRow=card.meta.length?`<div class="row"><span class="k">🗓</span><span class="v">${escapeHtml(card.meta.join(' · '))}</span></div>`:'';
 const closing=card.kind==='start'?'直播中':'已下播';
 const themeName=['amis','pink','min'].includes(theme)?theme:'amis';
 return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=640"></head>
<body class="theme-${themeName} kind-${card.kind==='start'?'start':'end'}">
<div class="card">
 <div class="band">
  <div class="band-deco" aria-hidden="true">
   <span class="deco s1">✦</span><span class="deco s2">✧</span><span class="deco s3">✦</span>
   <span class="deco s4">✧</span><span class="deco s5">✦</span>
  </div>
  <div class="stickers stickers-top">${stickerTags(stickers.top||[],'top')}</div>
 </div>
 <div class="head">
  <div class="avatar">${avatar}</div>
  <div class="head-body">
   <div class="head-row">
    <div class="who">
     <div class="name">${escapeHtml(card.name)}${stickerTags(stickers.tag||[],'tag')}</div>
     <div class="sub">B站直播 · ${escapeHtml(card.area||'虚拟主播')}</div>
    </div>
    <div class="qr">${qr}</div>
   </div>
   <div class="bubble"><span class="bubble-dot">${card.kind==='start'?'💙':'🌙'}</span>${escapeHtml(card.reply)}</div>
  </div>
 </div>
 <div class="cover">${cover}</div>
 <div class="title">${escapeHtml(card.title||'（未填写直播间标题）')}</div>
 ${durationRow}${metaRow}
 <div class="row"><span class="k">👉</span><span class="v mono">${escapeHtml(card.url.replace(/^https?:\/\//,''))}</span></div>
 <div class="foot"><span>✦</span> 爱弥斯 · B站识别 <span>✦</span><span class="state">${closing}</span></div>
 <div class="stickers stickers-corner">${stickerTags(stickers.corner||[],'corner')}</div>
</div>
</body></html>`;
}

// 各主题的 CSS。模板与样式分开保存，方便自行修改或替换。
export const THEME_CSS={
 amis:`
:root{--brand:#ff8fc0;--brand-deep:#e75f9c;--ink:#3b2b38;--soft:#8a7a86;--card:#fff;--bg:#fff0f6;--bubble:#ffe6f1;--bubble-ink:#d9427f;}
body{margin:0;background:var(--bg);}
.card{width:640px;box-sizing:border-box;margin:0;background:var(--card);border-radius:24px;overflow:hidden;box-shadow:0 8px 28px rgba(231,95,156,.16);color:var(--ink);}
.band{position:relative;height:176px;background:linear-gradient(135deg,#ffc7e0 0%,#ffd9ea 52%,#fff6fa 100%);}
.band-deco .deco{position:absolute;color:#fff;opacity:.85;}
.band-deco .s1{top:16px;left:26px;font-size:22px;}.band-deco .s2{top:52px;left:64px;font-size:14px;}
.band-deco .s3{top:20px;right:196px;font-size:18px;}.band-deco .s4{top:74px;right:150px;font-size:24px;}
.band-deco .s5{bottom:26px;left:220px;font-size:16px;}.stickers-top .sticker{position:absolute;top:8px;--s:52px;--r:-4deg;}
.stickers-top .sticker:nth-child(2n){--s:42px;--r:5deg;top:26px;}
.stickers-top .sticker:nth-child(3n){--s:60px;--r:-6deg;top:2px;}
.stickers-corner .sticker{position:absolute;right:16px;bottom:-8px;--s:76px;--r:7deg;}
.stickers-corner{position:relative;}
.sticker{--s:48px;--r:0deg;width:var(--s);height:auto;transform:rotate(var(--r));filter:drop-shadow(0 3px 6px rgba(231,95,156,.22));}
.sticker-tag{width:34px;margin-left:8px;vertical-align:middle;}


.avatar{box-sizing:border-box;width:96px;height:96px;flex:0 0 96px;border-radius:50%;background:#fff;padding:4px;box-shadow:0 4px 14px rgba(231,95,156,.28);}
.avatar-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;background:var(--brand);}
.avatar-empty{display:flex;align-items:center;justify-content:center;color:#fff;font-size:40px;font-weight:700;}
.who{flex:1;min-width:0;padding:6px 0;}
.name{font-size:30px;font-weight:800;color:var(--brand-deep);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sub{margin-top:6px;font-size:15px;color:var(--soft);}
.qr{box-sizing:border-box;flex:0 0 108px;width:108px;height:108px;background:#fff;border-radius:14px;padding:6px;margin-top:10px;box-shadow:0 4px 14px rgba(231,95,156,.22);}
.qr-img{width:100%;height:100%;display:block;}
.bubble{margin:16px 0 0;padding:16px 20px;background:var(--bubble);color:var(--bubble-ink);border-radius:18px;font-size:20px;font-weight:600;line-height:1.5;}
.bubble-dot{margin-right:8px;}
.cover{margin:20px 28px 0;border-radius:16px;overflow:hidden;background:#fdf1f6;}
.cover-img{width:100%;display:block;}
.cover-empty{height:240px;display:flex;align-items:center;justify-content:center;color:var(--soft);font-size:18px;}
.kind-end .cover-img{filter:brightness(.88) saturate(.92);}
.title{margin:18px 28px 0;font-size:22px;font-weight:700;line-height:1.45;word-break:break-word;}
.row{display:flex;gap:10px;margin:12px 28px 0;font-size:17px;color:var(--soft);line-height:1.5;}
.row .k{flex:0 0 auto;}
.row .v{flex:1;min-width:0;word-break:break-all;}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.foot{display:flex;align-items:center;gap:8px;margin-top:22px;padding:16px 28px 22px;border-top:1px dashed #ffd3e6;color:var(--brand);font-size:14px;}
.foot .state{margin-left:auto;background:var(--bubble);border-radius:999px;padding:3px 12px;color:var(--bubble-ink);font-size:13px;}
.head{position:relative;margin:0 28px;}
.head-body{margin-left:108px;}
.head-row{display:flex;align-items:flex-start;gap:14px;padding-top:16px;}
.avatar{position:absolute;left:0;top:20px;}
.who{flex:1;min-width:0;}

`,
 pink:`
:root{--brand:#fb7299;--brand-deep:#e05c85;--ink:#3b2b38;--soft:#8d8189;--card:#fff;--bg:#fdf3f6;--bubble:#fff2f6;--bubble-ink:#c9416d;}
body{margin:0;background:var(--bg);}
.card{width:640px;box-sizing:border-box;margin:0;background:var(--card);border-radius:24px;overflow:hidden;box-shadow:0 8px 28px rgba(251,114,153,.16);color:var(--ink);}
.band{position:relative;height:176px;background:linear-gradient(135deg,#fb7299 0%,#ffa9c4 55%,#ffd9e6 100%);}
.band-deco .deco{position:absolute;color:#fff;opacity:.9;}
.band-deco .s1{top:16px;left:26px;font-size:22px;}.band-deco .s2{top:52px;left:64px;font-size:14px;}
.band-deco .s3{top:20px;right:196px;font-size:18px;}.band-deco .s4{top:74px;right:150px;font-size:24px;}
.band-deco .s5{bottom:26px;left:220px;font-size:16px;}.stickers-top .sticker{position:absolute;top:8px;--s:52px;--r:-4deg;}
.stickers-top .sticker:nth-child(2n){--s:42px;--r:5deg;top:26px;}
.stickers-top .sticker:nth-child(3n){--s:60px;--r:-6deg;top:2px;}
.stickers-corner .sticker{position:absolute;right:16px;bottom:-8px;--s:76px;--r:7deg;}
.stickers-corner{position:relative;}
.sticker{--s:48px;--r:0deg;width:var(--s);height:auto;transform:rotate(var(--r));filter:drop-shadow(0 3px 6px rgba(251,114,153,.22));}
.sticker-tag{width:34px;margin-left:8px;vertical-align:middle;}


.avatar{box-sizing:border-box;width:96px;height:96px;flex:0 0 96px;border-radius:50%;background:#fff;padding:4px;box-shadow:0 4px 14px rgba(251,114,153,.3);}
.avatar-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;background:var(--brand);}
.avatar-empty{display:flex;align-items:center;justify-content:center;color:#fff;font-size:40px;font-weight:700;}
.who{flex:1;min-width:0;padding:6px 0;}
.name{font-size:30px;font-weight:800;color:var(--brand);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sub{margin-top:6px;font-size:15px;color:var(--soft);}
.qr{box-sizing:border-box;flex:0 0 108px;width:108px;height:108px;background:#fff;border-radius:14px;padding:6px;margin-top:10px;box-shadow:0 4px 14px rgba(251,114,153,.24);}
.qr-img{width:100%;height:100%;display:block;}
.bubble{margin:16px 0 0;padding:16px 20px;background:var(--bubble);color:var(--bubble-ink);border-radius:18px;font-size:20px;font-weight:600;line-height:1.5;}
.bubble-dot{margin-right:8px;}
.cover{margin:20px 28px 0;border-radius:16px;overflow:hidden;background:#fdf3f6;}
.cover-img{width:100%;display:block;}
.cover-empty{height:240px;display:flex;align-items:center;justify-content:center;color:var(--soft);font-size:18px;}
.kind-end .cover-img{filter:brightness(.88) saturate(.92);}
.title{margin:18px 28px 0;font-size:22px;font-weight:700;line-height:1.45;word-break:break-word;}
.row{display:flex;gap:10px;margin:12px 28px 0;font-size:17px;color:var(--soft);line-height:1.5;}
.row .k{flex:0 0 auto;}
.row .v{flex:1;min-width:0;word-break:break-all;}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.foot{display:flex;align-items:center;gap:8px;margin-top:22px;padding:16px 28px 22px;border-top:1px dashed #ffd9e6;color:var(--brand);font-size:14px;}
.foot .state{margin-left:auto;background:var(--bubble);border-radius:999px;padding:3px 12px;color:var(--bubble-ink);font-size:13px;}
.head{position:relative;margin:0 28px;}
.head-body{margin-left:108px;}
.head-row{display:flex;align-items:flex-end;gap:14px;padding-top:16px;}
.avatar{position:absolute;left:0;top:22px;}
.who{flex:1;min-width:0;}

`,
 min:`
:root{--brand:#5b6b7c;--brand-deep:#33414f;--ink:#20262c;--soft:#77828c;--card:#fff;--bg:#f4f6f8;--bubble:#eef2f6;--bubble-ink:#33414f;}
body{margin:0;background:var(--bg);}
.card{width:640px;box-sizing:border-box;margin:0;background:var(--card);border-radius:18px;overflow:hidden;box-shadow:0 6px 20px rgba(32,38,44,.1);color:var(--ink);}
.band{position:relative;height:150px;background:linear-gradient(135deg,#e8edf2 0%,#f6f8fa 100%);}
.band-deco,.stickers{display:none;}

.avatar{box-sizing:border-box;width:86px;height:86px;flex:0 0 86px;border-radius:50%;background:#fff;padding:3px;box-shadow:0 3px 10px rgba(32,38,44,.14);}
.avatar-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;background:var(--brand);}
.avatar-empty{display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;font-weight:700;}
.who{flex:1;min-width:0;padding:6px 0;}
.name{font-size:27px;font-weight:700;color:var(--brand-deep);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sub{margin-top:5px;font-size:14px;color:var(--soft);}
.qr{box-sizing:border-box;flex:0 0 96px;width:96px;height:96px;background:#fff;border-radius:10px;padding:5px;margin-top:8px;box-shadow:0 3px 10px rgba(32,38,44,.12);}
.qr-img{width:100%;height:100%;display:block;}
.bubble{margin:14px 0 0;padding:14px 18px;background:var(--bubble);color:var(--bubble-ink);border-radius:12px;font-size:19px;font-weight:600;line-height:1.5;}
.bubble-dot{margin-right:8px;}
.cover{margin:18px 26px 0;border-radius:12px;overflow:hidden;background:#f4f6f8;}
.cover-img{width:100%;display:block;}
.cover-empty{height:230px;display:flex;align-items:center;justify-content:center;color:var(--soft);font-size:17px;}
.kind-end .cover-img{filter:brightness(.9);}
.title{margin:16px 26px 0;font-size:21px;font-weight:700;line-height:1.45;word-break:break-word;}
.row{display:flex;gap:10px;margin:10px 26px 0;font-size:16px;color:var(--soft);line-height:1.5;}
.row .v{flex:1;min-width:0;word-break:break-all;}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.foot{display:flex;align-items:center;gap:8px;margin-top:20px;padding:14px 26px 20px;border-top:1px solid #e6ebf0;color:var(--brand);font-size:13px;}
.foot .state{margin-left:auto;background:var(--bubble);border-radius:999px;padding:3px 10px;color:var(--bubble-ink);font-size:12px;}
.head{position:relative;margin:0 26px;}
.head-body{margin-left:98px;}
.head-row{display:flex;align-items:flex-start;gap:12px;padding-top:14px;}
.avatar{position:absolute;left:0;top:18px;}
.who{flex:1;min-width:0;}

`,
};
export const themes=Object.keys(THEME_CSS);

// 把主题 CSS 内联进模板：渲染服务只拿到一段 HTML，不依赖任何本地文件。
export function buildCardHtml(card,{theme='amis',stickers={}}={}){
 const css=THEME_CSS[theme]||THEME_CSS.amis;
 return renderCardHtml(card,{theme,stickers}).replace('</head>',`<style>${css}</style></head>`);
}

const SERVICES={
 // AstrBot 官方文转图服务（astrbot-t2i-service）默认契约。
 astrbot:{path:'/text2img/generate',body:(html,options)=>({html,json:false,options})},
};

function normalizeBase(raw){
 const text=String(raw||'').trim().replace(/\/+$/,'');if(!text)return '';
 const withScheme=/^[a-z][a-z0-9+.-]*:\/\//i.test(text)?text:`http://${text}`;
 let url;try{url=new URL(withScheme);}catch{throw new Error('文转图服务地址无法解析，请填写形如 http://127.0.0.1:8999 的地址。');}
 if(!['http:','https:'].includes(url.protocol))throw new Error('文转图服务地址只支持 http 或 https。');
 if(url.username||url.password)throw new Error('文转图服务地址不要包含用户名或密码，请改用访问令牌配置项。');
 return url.href.replace(/\/+$/,'');
}
export const renderBase=normalizeBase;

export const IMAGE_MAGIC=[[0xff,0xd8,0xff],[0x89,0x50,0x4e,0x47],[0x47,0x49,0x46,0x38],[0x52,0x49,0x46,0x46]];
export function sniffImage(buffer){
 // 只按魔数判断，不要求最小长度：过于严格的长度下限会把合法的小图判成非图片。
 if(!buffer||buffer.length<4)return false;
 for(const magic of IMAGE_MAGIC){if(magic.every((byte,index)=>buffer[index]===byte))return true;}
 return false;
}

// 状态提示要能直接指路，不要只说"渲染失败"。
export function renderHint(reason,base){
 const where=base?`（${base}）`:'';
 return {
  OFF:'未配置文转图服务地址，直播通知使用「封面 + 文案」。',
  UNREACHABLE:`连接不上文转图服务${where}，请确认它已启动，并且 NapCat 能访问该地址。`,
  TIMEOUT:`文转图服务${where}响应超时，可调大渲染超时或检查服务负载。`,
  STATUS:`文转图服务${where}返回了错误状态，请查看服务日志。`,
  NOT_IMAGE:`文转图服务${where}没有返回图片，请确认地址指向文转图服务，而不是 AstrBot 主面板。`,
  EMPTY:`文转图服务${where}返回了空图片。`,
  TOO_LARGE:`文转图服务${where}返回的卡片过大，请检查模板尺寸。`,
  FORMAT:'文转图请求组装失败，请检查自定义请求模板是否为合法 JSON。',
  CACHE:'卡片缓存目录不可写，请检查插件数据目录权限。',
  BUILD:'卡片内容组装失败，本次降级为「封面 + 文案」。',
  PAUSED:'渲染服务连续失败，已临时暂停卡片渲染；通知仍会照常发送。',
 }[reason]||'卡片渲染失败，本次降级为「封面 + 文案」。';
}

// 调用外部文转图服务；失败时返回原因而不是抛错，让上层降级。
export async function renderCard(html,config,{fetcher=globalThis.fetch,log=()=>{}}={}){
 let base;try{base=normalizeBase(config.liveCardRenderUrl);}catch{return {ok:false,reason:'FORMAT'};}
 if(!base)return {ok:false,reason:'OFF'};
 const service=SERVICES[config.liveCardRenderMode]||SERVICES.astrbot;
 const timeoutMs=Math.max(3,Math.min(120,Number(config.liveCardRenderTimeoutSeconds)||25))*1000;
 // playwright 的 timeout 单位是毫秒（官方示例 timeout=30000），不是秒。
 // 之前错误地除以 1000，导致服务端只拿到 24ms，必然 TimeoutError → 500。
 // 这里给服务端留出比客户端超时略小的时间，让服务端有机会先返回自己的错误。
 const options={type:'jpeg',quality:92,full_page:true,viewport_width:Number(config.liveCardWidth)||640,viewport_height:1,scale:'device',device_scale_factor_level:'ultra',timeout:Math.max(1000,timeoutMs-2000),animations:'disabled',caret:'hide'};
 let payload;
 try{payload=JSON.stringify(service.body(html,options));}
 catch{return {ok:false,reason:'FORMAT'};}
 const headers={'Content-Type':'application/json',Accept:'image/jpeg,image/png,application/json'};
 if(config.liveCardRenderToken)headers.Authorization=`Bearer ${String(config.liveCardRenderToken).trim()}`;
 const started=Date.now();
 let response;
 try{
  response=await fetcher(`${base}${service.path}`,{method:'POST',headers,body:payload,signal:AbortSignal.timeout(timeoutMs)});
 }catch(e){
  const reason=e?.name==='TimeoutError'?'TIMEOUT':e?.name==='AbortError'?'TIMEOUT':'UNREACHABLE';
  log('warn',`[CARD] ${renderHint(reason,base)}`);return {ok:false,reason,base};
 }
 try{
  if(!response.ok){
   let detail='';
   try{const raw=await response.text();detail=String(raw||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,200);}catch{}
   log('warn',`[CARD] 文转图服务返回 HTTP ${response.status}${detail?`：${detail}`:'。'} 请查看渲染服务日志。`);
   return {ok:false,reason:'STATUS',status:response.status,base,detail};
  }
  const type=String(response.headers?.get?.('content-type')||'');
  let buffer;
  if(type.includes('application/json')){
   const data=await response.json().catch(()=>null);
   const id=data?.data?.id;
   if(typeof id!=='string'||!id)return {ok:false,reason:'NOT_IMAGE',base};
   const follow=await fetcher(`${base}/text2img/data/${encodeURIComponent(id.replace(/^data\//,''))}`,{signal:AbortSignal.timeout(timeoutMs)});
   if(!follow.ok)return {ok:false,reason:'STATUS',status:follow.status,base};
   buffer=Buffer.from(await follow.arrayBuffer());
  }else{
   buffer=Buffer.from(await response.arrayBuffer());
  }
  if(!buffer.length)return {ok:false,reason:'EMPTY',base};
  if(!sniffImage(buffer))return {ok:false,reason:'NOT_IMAGE',base};
  if(buffer.length>8*1024*1024)return {ok:false,reason:'TOO_LARGE',base};
  return {ok:true,buffer,base,ms:Date.now()-started};
 }catch(e){
  const reason=e?.name==='TimeoutError'?'TIMEOUT':'UNREACHABLE';
  return {ok:false,reason,base};
 }
}

// 内联图片上限：超过就放弃这张图（宁可少一张图，也不要几百 KB 的 HTML 拖垮渲染服务）。
// 卡片图片只可能来自 B站图床，白名单限定在这里，避免请求通道被当成任意代理。
export const IMAGE_HOST_ALLOWLIST=['hdslb.com'];
export const CARD_FAILURE_THRESHOLD=3;
export const CARD_PAUSE_MS=5*60*1000;
export const INLINE_IMAGE_MAX_BYTES=500*1024;
export const COVER_THUMB_WIDTH=640;
export const AVATAR_THUMB_WIDTH=160;
// hdslb 图床的图片处理参数（实测：只给宽度时高度自适应，加 _1c 需同时给宽高才生效）。
//   @640w_90q.webp     → 缩略图 + 质量 90 + 转 WebP
//   @160w_1c_90q.webp  → 再按 1:1 居中裁剪（头像用）
export function thumbnailUrl(url,width,ratio=''){
 if(!width)return '';
 const safe=safeImageUrl(url);if(!safe)return '';
 if(safe.includes('@'))return safe;
 return `${safe}@${width}w${ratio?`_${ratio}`:''}_90q.webp`;
}

// 贴纸目录：只读取允许的图片后缀，限制单文件与总量，避免误放的大文件把卡片撑爆。
export const STICKER_SLOTS=[['top','顶部装饰带'],['tag','名字旁徽章'],['corner','右下角']];
const stickerExt=name=>/\.(png|jpe?g|webp|gif)$/i.test(name)?name.toLowerCase().split('.').pop().replace('jpeg','jpg'):'';
const stickerMime=ext=>({png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[ext]||'');
export async function loadStickers(dir,fs){
 const groups={top:[],tag:[],corner:[]};const problems=[];
 let names=[];try{names=await fs.readdir(dir);}catch{return {groups,problems,count:0};}
 names.sort();
 let total=0;
 for(const name of names){
  if(name.startsWith('.'))continue;
  const slot=STICKER_SLOTS.map(([key])=>key).find(key=>name.toLowerCase().startsWith(key+'-'));
  if(!slot||!stickerExt(name))continue;
  const full=path.join(dir,name);
  try{
   const stat=await fs.stat(full);
   if(!stat.isFile())continue;
   if(stat.size>2*1024*1024){problems.push(`${name}：超过 2MB，已跳过`);continue;}
   if(total+stat.size>10*1024*1024){problems.push(`${name}：自备贴纸总量超过 10MB，已跳过`);continue;}
   total+=stat.size;
   const data=await fs.readFile(full);
   groups[slot].push({name,mime:stickerMime(stickerExt(name)),dataUri:`data:${stickerMime(stickerExt(name))};base64,${data.toString('base64')}`});
  }catch{problems.push(`${name}：读取失败，已跳过`);}
 }
 return {groups,problems,count:groups.top.length+groups.tag.length+groups.corner.length};
}

// 组装卡片用到的图片：封面与头像走 B站图床（复用插件的请求通道），二维码用内置库本地生成。
export async function collectCardImages(client,card,{stickerDir,fs,decor='auto'}={}){
 const images={cover:'',avatar:'',stickers:{top:[],tag:[],corner:[]},problems:[]};
 // B站图床支持按宽度取缩略图（会自动转 WebP）。卡片封面在卡片里按 CSS 像素显示，
 // 直接内联原图会让 HTML 膨胀到几百 KB，拖慢甚至压垮渲染服务；这里优先取缩略图，
 // 取不到再回退原图，保证不会因为图床参数变化导致没有封面。
 const fetchOnce=async target=>{
  try{
   // 图床在 *.hdslb.com 上，BiliClient 默认只放行 bilibili.com / b23.tv（那是短链跳转校验），
   // 所以这里显式放行图床域名；其余限制（https、无端口、无凭据）不变。
   const response=await client.request(target,{allowedHosts:IMAGE_HOST_ALLOWLIST,raw:true,referer:'https://live.bilibili.com/'});
   if(!response.ok){try{await response.body?.cancel?.();}catch{}return null;}
   const buffer=Buffer.from(await response.arrayBuffer());
   if(!buffer.length||buffer.length>INLINE_IMAGE_MAX_BYTES)return null;
   const type=String(response.headers?.get?.('content-type')||'').split(';')[0];
   if(type&&!type.startsWith('image/'))return null;
   return {buffer,type:type||'image/jpeg'};
  }catch{return null;}
 };
 const fetchDataUri=async(url,{width=0,ratio='' }={})=>{
  const safe=safeImageUrl(url);if(!safe)return '';
  const thumb=thumbnailUrl(safe,width,ratio);
  const attempt=thumb?await fetchOnce(thumb):null;
  const result=attempt||await fetchOnce(safe);
  if(!result)return '';
  return `data:${result.type};base64,${result.buffer.toString('base64')}`;
 };
 images.cover=await fetchDataUri(card.coverSource,{width:COVER_THUMB_WIDTH});
 images.avatar=await fetchDataUri(card.avatarSource,{width:AVATAR_THUMB_WIDTH,ratio:'1c'});
 try{images.qr=qrImage(card.url);}catch{images.qr='';}
 if(decor!=='off'&&stickerDir){
  const loaded=await loadStickers(stickerDir,fs);
  images.stickers=loaded.groups;images.problems=loaded.problems;
 }
 return images;
}

// 卡片渲染器：一次渲染、多群复用，失败只返回原因供上层降级，绝不抛出。
// 渲染结果按内容哈希落盘缓存，避免同一场直播对每个群重复调用文转图服务。
// 注意：渲染器只允许通过 this.emit 写日志，任何日志异常都不能让通知丢失。
export class CardRenderer{
 constructor({dir,assetDir,getConfig,getState,log=()=>{},fs,fetcher=globalThis.fetch,now=Date.now}){
  this.dir=dir;this.assetDir=assetDir;this.getConfig=getConfig;this.getState=getState;this.log=log;
  this.fs=fs;this.fetcher=fetcher;this.now=now;this.status={ok:false,reason:'OFF',base:'',at:0,ms:0};this.lastCleanup=0;
 // 熔断状态：连续失败到阈值后暂停渲染一段时间，之后自动重试。
 this.failures=0;this.pausedUntil=0;this.pauseNoticeAt=0;
 // 日志通道兜底：调用方给的 log 不合法时不能让渲染流程抛出异常。
 this.emit=typeof log==='function'?log:()=>{};
 }
 get enabled(){const c=this.getConfig();return !!(c?.liveCard&&c.liveCardRenderUrl);}
 status_(){return {...this.status};}
 async init(){
  try{await this.fs.mkdir(this.dir,{recursive:true});}catch(e){this.emit('warn','卡片缓存目录创建失败，直播通知将使用「封面 + 文案」。');}
  return this.cleanup();
 }
 // 按容量上限清理旧卡片；按修改时间从新到旧保留。
 async cleanup(){
  try{
   const cap=Math.max(16,Math.min(512,Number(this.getConfig()?.liveCardCacheMB)||64))*1024*1024;
   const names=await this.fs.readdir(this.dir);const files=[];
   for(const name of names){
    if(!name.endsWith('.img'))continue;
    const full=path.join(this.dir,name);
    try{const stat=await this.fs.stat(full);files.push({full,size:Number(stat.size)||0,time:Number(stat.mtimeMs)||0});}catch{}
   }
   files.sort((a,b)=>b.time-a.time);
   let total=0;
   for(const file of files){
    total+=file.size;
    // 超过容量上限的旧卡片清掉；兜底再清掉超过 7 天的，避免长期堆在数据目录里。
    if(total>cap||this.now()-file.time>7*24*3600*1000)await this.fs.rm(file.full,{force:true}).catch(()=>{});
   }
  }catch{}
 }
 // 同一场直播的卡片在缓存有效期内直接复用，不再调用渲染服务。
 async render(card,{force=false}={}){
  const config=this.getConfig();
  // 熔断期内直接降级，不再请求渲染服务；到点后自动放行重试。
  if(!force&&this.pausedUntil>this.now()){
   return {ok:false,reason:'PAUSED',hint:`卡片渲染已暂停约 ${Math.max(1,Math.ceil((this.pausedUntil-this.now())/60000))} 分钟（渲染服务连续失败），期间通知使用「封面 + 文案」。`};
  }
  const stickers=await this.stickers_();
  const html=buildCardHtml(card,{theme:config.liveCardTheme,stickers});
  const key=hashKey([config.liveCardTheme,config.liveCardPersona,card.kind,card.name,card.title,card.url,card.reply,card.duration,card.meta.join('|'),html.length,stickers.signature]);
  const file=path.join(this.dir,`${key}.img`);
  if(!force){
   try{const stat=await this.fs.stat(file);if(stat.size>0){this.status={ok:true,reason:'CACHE',base:this.status.base,at:this.now(),ms:0};return {ok:true,file,cached:true};}}catch{}
  }
  const result=await renderCard(html,config,{fetcher:this.fetcher,log:(level,message)=>{try{this.emit(level,message);}catch{}}});
  if(!result.ok){
   this.status={ok:false,reason:result.reason,base:result.base||'',at:this.now(),ms:0,status:result.status,detail:result.detail||''};
   this.failures++;
   if(this.failures>=CARD_FAILURE_THRESHOLD){
    // 只提醒一次，避免每轮都刷屏；期间通知继续走降级通道，不会漏。
    if(this.now()-this.pauseNoticeAt>CARD_PAUSE_MS){
     this.pauseNoticeAt=this.now();
     this.emit('warn',`卡片渲染连续失败 ${this.failures} 次（最近原因：${result.reason}），暂停 ${CARD_PAUSE_MS/60000} 分钟；期间直播通知照常发送，只改发「封面 + 文案」。`);
    }
    this.pausedUntil=this.now()+CARD_PAUSE_MS;this.failures=0;
   }
   return {ok:false,reason:result.reason,hint:renderHint(result.reason,result.base)};
  }
  this.failures=0;this.pausedUntil=0;
  try{
   const temp=file+'.tmp';
   await this.fs.mkdir(this.dir,{recursive:true});
   await this.fs.writeFile(temp,result.buffer);
   await this.fs.rename(temp,file);
  }catch{this.status={ok:false,reason:'CACHE',base:this.status.base,at:this.now(),ms:0};return {ok:false,reason:'CACHE',hint:renderHint('CACHE')};}
  this.status={ok:true,reason:'OK',base:result.base,at:this.now(),ms:result.ms||0};
  await this.cleanup();
  return {ok:true,file,bytes:result.buffer.length};
 }
 async stickers_(){
  // 无论成败都返回完整结构：装饰关闭、目录缺失时也是空数组，调用方不用做空值判断。
  const empty={top:[],tag:[],corner:[],signature:'',problems:[],count:0};
  try{
   const config=this.getConfig();
   if(config.liveCardDecor==='off'||!this.assetDir)return empty;
   const loaded=await loadStickers(path.join(this.assetDir,'custom'),this.fs);
   const signature=Object.values(loaded.groups).flat().map(item=>item.name).join(',');
   return {top:loaded.groups.top,tag:loaded.groups.tag,corner:loaded.groups.corner,problems:loaded.problems,count:loaded.count,signature};
  }catch{return empty;}
 }
 // 渲染服务连通性自检：出图即正常，失败带可直接照做的提示。
 async test(){
  const config=this.getConfig();
  if(!config.liveCardRenderUrl)return {ok:false,reason:'OFF',hint:renderHint('OFF')};
  const card={kind:'start',name:'渲染自检',area:'测一测',title:'爱弥斯渲染自检：中文、emoji 💙✦ 与二维码',url:'https://live.bilibili.com/1',reply:'爱弥斯上线啦！这是一张自检卡片～',duration:null,timeText:'',meta:['⏰ 自检'],cover:'',avatar:'',qr:''};
  try{card.qr=qrImage(card.url);}catch{}
  const result=await renderCard(buildCardHtml(card,{theme:config.liveCardTheme}),config,{fetcher:this.fetcher,log:(level,message)=>{try{this.emit(level,message);}catch{}}});
  if(!result.ok)return {ok:false,reason:result.reason,base:result.base,hint:renderHint(result.reason,result.base)};
  return {ok:true,bytes:result.buffer.length,ms:result.ms,base:result.base};
 }
}

function hashKey(parts){
 // 内容哈希：同样的卡片内容复用同一个文件，内容变了自然生成新文件。
 let h1=0x811c9dc5,h2=0x1000193;
 const text=parts.map(part=>String(part??'')).join('\u0000');
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  h1=(h1^code)>>>0;h1=Math.imul(h1,0x01000193)>>>0;
  h2=((h2<<5)-h2+code)>>>0;
 }
 return `${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}`;
}
