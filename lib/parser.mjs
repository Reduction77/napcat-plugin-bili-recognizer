// Structured resource routing adapted from UnsplashZ/bili-qq-bot (ISC).
import upstream from './upstream-structured.cjs';
export const labels = {video:'视频',bangumi:'番剧',ep:'剧集',media:'影视',dynamic:'动态',opus:'图文',article:'专栏',live:'直播间',user:'用户主页',favorite_list:'收藏夹',audio:'音频',audio_list:'歌单',article_list:'文集',topic:'话题',channel_series:'合集/系列',note:'笔记',cheese_video:'课堂'};
export function safeBiliUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    if (!['bilibili.com','www.bilibili.com','m.bilibili.com','t.bilibili.com','space.bilibili.com','live.bilibili.com','b23.tv','www.b23.tv'].includes(u.hostname)) return null;
    u.protocol = 'https:';
    return u;
  } catch { return null; }
}
function decode(s) {
  return String(s || '').replace(/\\\//g,'/').replace(/\\u002[fF]/g,'/').replace(/&#44;/g,',').replace(/&#91;/g,'[').replace(/&#93;/g,']').replace(/&amp;/g,'&');
}
export function messageText(event) {
  const parts = [];
  for (const seg of Array.isArray(event.message) ? event.message : []) {
    if (seg.type === 'text') parts.push(seg.data?.text || '');
    if (['json','xml'].includes(seg.type)) {
      const d = seg.data?.data;
      parts.push(typeof d === 'object' ? JSON.stringify(d) : d || '');
    }
  }
  if (!parts.length) parts.push(typeof event.message === 'string' ? event.message : event.raw_message || '');
  return decode(parts.join(' ').slice(0,20000));
}
export function canonical(link) {
  const {type:t,id,meta={}}=link;
  const paths={video:`video/${id}`,bangumi:`bangumi/play/ss${id}`,ep:`bangumi/play/ep${id}`,media:`bangumi/media/md${id}`,opus:`opus/${id}`,article:`read/cv${id}`,favorite_list:`medialist/detail/ml${id}`,audio:`audio/au${id}`,audio_list:`audio/am${id}`,article_list:`read/readlist/rl${id}`,note:`h5/note-app/view?cvid=${id}`,topic:`v/topic/detail?topic_id=${id}`,cheese_video:`cheese/play/${meta.seasonId?'ss':'ep'}${id}`};
  if(t==='dynamic') return `https://t.bilibili.com/${id}`;
  if(t==='live') return `https://live.bilibili.com/${id}`;
  if(t==='user') return `https://space.bilibili.com/${id}`;
  if(t==='channel_series') return `https://space.bilibili.com/${meta.uid}/channel/${meta.seriesType==='season'?'collectiondetail':'seriesdetail'}?sid=${id}`;
  return `https://www.bilibili.com/${paths[t]}`;
}
export function parseUrl(value) {
  const u=safeBiliUrl(value); if(!u) return null;
  if(u.hostname.endsWith('b23.tv')) return /^[a-zA-Z0-9]+$/.test(u.pathname.slice(1)) ? {type:'short',id:u.pathname.slice(1),url:`https://b23.tv${u.pathname}`,key:`short:${u.pathname}`} : null;
  const st=upstream.parseStructuredToken(upstream.buildTokenInfo(u.href));
  let link=st.link;
  if(st.handled && !link) return null;
  if(!st.handled) {
    const p=u.pathname;
    const rules=[
      ['video',/^\/video\/(BV[a-zA-Z0-9]{10}|av\d+)(?:\/|$)/i],
      ['bangumi',/^\/bangumi\/play\/ss(\d+)(?:\/|$)/],['ep',/^\/bangumi\/play\/ep(\d+)(?:\/|$)/],
      ['media',/^\/bangumi\/media\/md(\d+)(?:\/|$)/],['article',/^\/read\/cv(\d+)(?:\/|$)/],
      ['opus',/^\/opus\/(\d+)(?:\/|$)/],['dynamic',/^\/dynamic\/(\d+)(?:\/|$)/],
      ['favorite_list',/^\/medialist\/detail\/ml(\d+)(?:\/|$)/i],['audio',/^\/audio\/au(\d+)(?:\/|$)/i],
      ['audio_list',/^\/audio\/am(\d+)(?:\/|$)/i],['article_list',/^\/read\/readlist\/rl(\d+)(?:\/|$)/i]
    ];
    if(u.hostname==='t.bilibili.com') rules.unshift(['dynamic',/^\/(\d+)(?:\/|$)/]);
    if(u.hostname==='live.bilibili.com') rules.unshift(['live',/^\/(?:blanc\/)?(\d+)(?:\/|$)/]);
    for(const [type,re] of rules) { const m=p.match(re); if(m){link={type,id:m[1],meta:{}};break;} }
  }
  if(!link || !/^(?:BV[a-zA-Z0-9]{10}|av\d+|\d+)$/i.test(link.id)) return null;
  if(link.type==='video') link.id=link.id.slice(0,2).toLowerCase()==='bv'?'BV'+link.id.slice(2):link.id.toLowerCase();
  if(link.type==='video'&&/^\d+$/.test(u.searchParams.get('p')||''))link.meta={...link.meta,page:Number(u.searchParams.get('p'))};
  return {...link,url:canonical(link),key:`${link.type==='opus'?'dynamic':link.type}:${link.meta?.uniqueId||link.id}`};
}
export function extract(text, bareIds=true) {
  text=decode(text).slice(0,20000);
  const results=[];
  const add=l=>{if(l&&!results.some(x=>x.key===l.key))results.push(l);};
  // Consume whole URLs first so a BV embedded in an unrelated domain is not treated as a bare ID.
  const token=/(?:https?:\/\/|(?<![\w.@/])(?:[a-zA-Z0-9-]+\.)*bilibili\.com\/|(?<![\w.@/])b23\.tv\/)[^\s<>"'\\，。！？；（）【】《》]+/gi;
  const remainder=text.replace(token,s=>{const v=s.replace(/[)\]},;!?]+$/,''); add(parseUrl(/^https?:/i.test(v)?v:'https://'+v));return ' ';});
  if(bareIds) for(const m of remainder.matchAll(/(?<![a-zA-Z0-9_])(?:BV[a-zA-Z0-9]{10}|av\d+|cv\d+|ss\d+|ep\d+|md\d+|au\d+|am\d+|ml\d+|rl\d+)(?![a-zA-Z0-9_])/gi)) {
    const pre=m[0].slice(0,2).toLowerCase();
    const types={bv:'video',av:'video',cv:'article',ss:'bangumi',ep:'ep',md:'media',au:'audio',am:'audio_list',ml:'favorite_list',rl:'article_list'};
    const type=types[pre],id=pre==='bv'?'BV'+m[0].slice(2):pre==='av'?m[0].toLowerCase():m[0].slice(2);
    add(parseUrl(canonical({type,id})));
  }
  return results.slice(0,12);
}
