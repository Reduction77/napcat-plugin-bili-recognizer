export const defaults={enabled:true,groupEnabled:true,privateEnabled:true,groupMode:'all',groupIds:'',blockedUsers:'',bareIds:true,showCover:true,showStats:true,showDescription:true,descriptionLength:180,cooldownSeconds:120,maxLinks:2,timeoutSeconds:10,cookie:'',notifyErrors:true,debug:false,requestGapMs:1500,riskCooldownSeconds:300,playurlMode:'wbi',downloadMode:'command',downloadQuality:32,downloadMaxMB:100,downloadMaxSeconds:600,downloadTimeoutSeconds:300,downloadCacheMB:512,downloadKeepHours:6,ffmpegPath:'ffmpeg',liveCard:true,liveCardRenderUrl:'',liveCardRenderMode:'astrbot',liveCardCustomRequest:'',liveCardRenderToken:'',liveCardPersona:'amis',liveCardTheme:'amis',liveCardDecor:'auto',liveCardRenderTimeoutSeconds:25,liveCardCacheMB:64};
const bool=(key,label,description='')=>({key,label,type:'boolean',default:defaults[key],description});
const num=(key,label,description)=>({key,label,type:'number',default:defaults[key],description});
export const schema=[
 bool('enabled','启用 B站识别'),bool('groupEnabled','群聊识别'),bool('privateEnabled','私聊识别'),
 {key:'groupMode',label:'群聊范围',type:'select',default:'all',options:[{label:'所有群',value:'all'},{label:'仅列表中的群',value:'allow'},{label:'排除列表中的群',value:'deny'}]},
 {key:'groupIds',label:'群号列表',type:'string',default:'',description:'多个群号用空格、逗号或换行分隔；白名单留空时不响应任何群。'},
 {key:'blockedUsers',label:'忽略的 QQ 号',type:'string',default:''},
 bool('bareIds','识别单独发送的 BV / AV 等编号'),bool('showCover','发送封面图片','图片发送失败时尝试改发纯文字。'),bool('showStats','显示播放、点赞等统计'),bool('showDescription','显示简介'),
 num('descriptionLength','简介最大字数','20–1000，默认 180'),num('cooldownSeconds','同一内容重复回复间隔（秒）','0–3600；按群或私聊分别计时，默认 120'),
 num('maxLinks','每条消息最多解析数量','1–5，默认 2'),num('timeoutSeconds','单次请求超时（秒）','3–30，默认 10'),
 {key:'cookie',label:'B站 Cookie（可选）',type:'string',default:'',description:'普通公开视频通常可不填。部分动态或用户信息可能需要登录。此项按明文配置保存，仅在受信任的 NapCat 管理面板填写，勿发到群里。'},
 {key:'playurlMode',label:'播放地址接口',type:'select',default:'wbi',options:[{label:'WBI（含 dm 参数）',value:'wbi'},{label:'旧接口（手动对照）',value:'legacy'}]},
 {key:'downloadMode',label:'视频下载方式',type:'select',default:'command',options:[{label:'仅下载指令',value:'command'},{label:'识别后自动下载',value:'auto'},{label:'关闭 QQ 下载',value:'off'}]},
 {key:'downloadQuality',label:'下载清晰度上限',type:'select',default:32,options:[{label:'360P',value:16},{label:'480P（需要 FFmpeg 合并）',value:32},{label:'720P（通常需要 FFmpeg）',value:64},{label:'1080P（通常需要 FFmpeg）',value:80}]},
 num('downloadMaxMB','单视频大小上限（MB）','10–500，默认 100'),num('downloadMaxSeconds','单视频时长上限（秒）','30–7200，默认 600'),num('downloadTimeoutSeconds','单次下载总超时（秒）','30–1800，默认 300'),num('downloadCacheMB','下载缓存总容量（MB）','100–5000，默认 512'),num('downloadKeepHours','下载保留时间（小时）','1–72，默认 6'),
 {key:'ffmpegPath',label:'FFmpeg 可执行文件',type:'string',default:'ffmpeg',description:'可填写服务器上的完整可执行文件路径；留空使用系统 ffmpeg。'},
 bool('liveCard','直播通知使用图片卡片','关闭后开播／下播通知回到纯文字。卡片由外部文转图服务渲染。'),
 {key:'liveCardRenderUrl',label:'文转图服务地址',type:'string',default:'',description:'例如 http://127.0.0.1:8999（AstrBot 默认的文转图服务）。留空时直播通知使用「封面 + 文案」，不会报错。'},
 {key:'liveCardRenderMode',label:'文转图请求格式',type:'select',default:'astrbot',options:[{label:'AstrBot 文转图服务',value:'astrbot'},{label:'自定义请求 JSON',value:'custom'}]},
 {key:'liveCardCustomRequest',label:'自定义请求 JSON',type:'string',default:'',description:'仅“自定义请求 JSON”时需要：请求体模板，用 {{html}} 表示卡片 HTML。例如 {"html":"{{html}}"}；占位符要带引号。'},
 {key:'liveCardRenderToken',label:'文转图服务令牌（可选）',type:'string',default:'',description:'以 Bearer 形式放在请求头。服务无鉴权时留空。'},
 {key:'liveCardPersona',label:'通知口吻',type:'select',default:'amis',options:[{label:'爱弥斯 · 活泼俏皮',value:'amis'},{label:'软萌 · 轻声细语',value:'soft'},{label:'朴素 · 沿用原格式',value:'plain'}],description:'爱弥斯为《鸣潮》角色：星炬学院学生、隧者适格者、电子幽灵，官方性格描述为活泼俏皮。'},
 {key:'liveCardTheme',label:'卡片配色',type:'select',default:'amis',options:[{label:'爱弥斯蓝粉',value:'amis'},{label:'B站粉',value:'pink'},{label:'极简',value:'min'}]},
 {key:'liveCardDecor',label:'卡片装饰',type:'select',default:'auto',options:[{label:'自动：有自备贴纸就用',value:'auto'},{label:'仅内置装饰',value:'builtin'},{label:'不叠加贴纸',value:'off'}],description:'自备贴纸放在插件 assets/card/custom/ 目录，文件名前缀 top- / tag- / corner- 决定叠加位置。'},
 num('liveCardRenderTimeoutSeconds','卡片渲染超时（秒）','3–120，默认 25；文转图服务较慢或首次启动时可调大。'),
 num('liveCardCacheMB','卡片缓存上限（MB）','16–512，默认 64；按主播与标题缓存最近渲染的卡片。'),
 num('requestGapMs','B站请求最小间隔（毫秒）','500–10000，默认 1500'),num('riskCooldownSeconds','412 / 429 冷却（秒）','60–3600，默认 300'),
 bool('notifyErrors','解析失败时回复简短提示'),bool('debug','调试日志','在 NapCat 日志查看识别类型和跳过原因，不记录 Cookie 或原消息。')
];
export function normalize(raw={}) {
 const c={...defaults}; if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('配置必须为对象');
 for(const k of Object.keys(c)) if(raw[k]!==undefined){if(typeof c[k]==='boolean'){if(typeof raw[k]!=='boolean')throw new Error(`${k} 必须为开关值`);c[k]=raw[k];}else c[k]=raw[k];}
 for(const [k,min,max] of [['descriptionLength',20,1000],['cooldownSeconds',0,3600],['maxLinks',1,5],['timeoutSeconds',3,30],['requestGapMs',500,10000],['riskCooldownSeconds',60,3600],['downloadMaxMB',10,500],['downloadMaxSeconds',30,7200],['downloadTimeoutSeconds',30,1800],['downloadCacheMB',100,5000],['downloadKeepHours',1,72],['liveCardRenderTimeoutSeconds',3,120],['liveCardCacheMB',16,512]]){const n=Number(c[k]);if(!Number.isFinite(n))throw new Error(`${k} 必须为数字`);c[k]=Math.min(max,Math.max(min,Math.floor(n)));}
 if(!['wbi','legacy'].includes(c.playurlMode))throw new Error('播放地址接口无效');
 if(!['off','command','auto'].includes(c.downloadMode))throw new Error('下载方式无效');
 c.downloadQuality=Number(c.downloadQuality);if(![16,32,64,80].includes(c.downloadQuality))throw new Error('下载清晰度无效');
 c.ffmpegPath=String(c.ffmpegPath||'ffmpeg').trim();if(/[\r\n\0]/.test(c.ffmpegPath))throw new Error('FFmpeg 路径无效');
 if(c.downloadCacheMB<c.downloadMaxMB*2)throw new Error('缓存总容量至少为单视频大小上限的两倍，用于音视频合并');
 if(!['all','allow','deny'].includes(c.groupMode))throw new Error('群聊范围无效');
 for(const k of ['groupIds','blockedUsers']){c[k]=String(c[k]||'').trim();if(c[k]&&!/^[\d\s,，;；]+$/.test(c[k]))throw new Error(`${k} 只能填写数字账号和分隔符`);}
 c.cookie=String(c.cookie||'').trim().replace(/^cookie:\s*/i,'');if(/[\r\n]/.test(c.cookie))throw new Error('Cookie 必须为单行');
 // 直播卡片：地址可以留空（自动降级为「封面 + 文案」），但填了就必须是干净的 http/https 地址。
 if(!['astrbot','custom'].includes(c.liveCardRenderMode))throw new Error('文转图请求格式无效');
 if(!['amis','soft','plain'].includes(c.liveCardPersona))throw new Error('通知口吻无效');
 if(!['amis','pink','min'].includes(c.liveCardTheme))throw new Error('卡片配色无效');
 if(!['auto','builtin','off'].includes(c.liveCardDecor))throw new Error('卡片装饰设置无效');
 c.liveCardRenderUrl=String(c.liveCardRenderUrl||'').trim().replace(/\/+$/,'');
 if(c.liveCardRenderUrl){
  if(!/^https?:\/\//i.test(c.liveCardRenderUrl))c.liveCardRenderUrl=`http://${c.liveCardRenderUrl}`;
  let url;try{url=new URL(c.liveCardRenderUrl);}catch{throw new Error('文转图服务地址无法解析，请填写形如 http://127.0.0.1:8999 的地址。');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('文转图服务地址只支持 http 或 https');
  if(url.username||url.password||url.port&&!/^\d+$/.test(url.port))throw new Error('文转图服务地址不能包含用户名、密码或非法端口');
  c.liveCardRenderUrl=url.href.replace(/\/+$/,'');
 }
 c.liveCardRenderToken=String(c.liveCardRenderToken||'').trim();if(/[\r\n]/.test(c.liveCardRenderToken))throw new Error('文转图服务令牌必须为单行');
 c.liveCardCustomRequest=String(c.liveCardCustomRequest||'').trim();if(/[\r\n]{2,}/.test(c.liveCardCustomRequest))throw new Error('自定义请求 JSON 不应包含空行');
 if(c.liveCardRenderMode==='custom'){
  if(!c.liveCardRenderUrl)throw new Error('选择“自定义请求 JSON”时必须同时填写文转图服务地址');
  let parsed=null;try{parsed=JSON.parse(c.liveCardCustomRequest);}catch{throw new Error('自定义请求 JSON 不是合法的 JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('自定义请求 JSON 必须是一个对象');
  const hits=(c.liveCardCustomRequest.match(/\{\{html\}\}/g)||[]).length;
  if(hits!==1)throw new Error('自定义请求 JSON 必须且只能包含一处 {{html}} 占位符');
 }
 return c;
}
export const ids=s=>new Set(String(s).split(/[\s,，;；]+/).filter(Boolean));
