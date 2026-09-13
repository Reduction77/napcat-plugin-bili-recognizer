export const defaults={enabled:true,groupEnabled:true,privateEnabled:true,groupMode:'all',groupIds:'',blockedUsers:'',bareIds:true,showCover:true,showStats:true,showDescription:true,descriptionLength:180,cooldownSeconds:120,maxLinks:2,timeoutSeconds:10,cookie:'',notifyErrors:true,debug:false,requestGapMs:1500,riskCooldownSeconds:300,playurlMode:'wbi',downloadMode:'command',downloadQuality:32,downloadMaxMB:100,downloadMaxSeconds:600,downloadTimeoutSeconds:300,downloadCacheMB:512,downloadKeepHours:6,ffmpegPath:'ffmpeg'};
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
 num('requestGapMs','B站请求最小间隔（毫秒）','500–10000，默认 1500'),num('riskCooldownSeconds','412 / 429 冷却（秒）','60–3600，默认 300'),
 bool('notifyErrors','解析失败时回复简短提示'),bool('debug','调试日志','在 NapCat 日志查看识别类型和跳过原因，不记录 Cookie 或原消息。')
];
export function normalize(raw={}) {
 const c={...defaults}; if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('配置必须为对象');
 for(const k of Object.keys(c)) if(raw[k]!==undefined){if(typeof c[k]==='boolean'){if(typeof raw[k]!=='boolean')throw new Error(`${k} 必须为开关值`);c[k]=raw[k];}else c[k]=raw[k];}
 for(const [k,min,max] of [['descriptionLength',20,1000],['cooldownSeconds',0,3600],['maxLinks',1,5],['timeoutSeconds',3,30],['requestGapMs',500,10000],['riskCooldownSeconds',60,3600],['downloadMaxMB',10,500],['downloadMaxSeconds',30,7200],['downloadTimeoutSeconds',30,1800],['downloadCacheMB',100,5000],['downloadKeepHours',1,72]]){const n=Number(c[k]);if(!Number.isFinite(n))throw new Error(`${k} 必须为数字`);c[k]=Math.min(max,Math.max(min,Math.floor(n)));}
 if(!['wbi','legacy'].includes(c.playurlMode))throw new Error('播放地址接口无效');
 if(!['off','command','auto'].includes(c.downloadMode))throw new Error('下载方式无效');
 c.downloadQuality=Number(c.downloadQuality);if(![16,32,64,80].includes(c.downloadQuality))throw new Error('下载清晰度无效');
 c.ffmpegPath=String(c.ffmpegPath||'ffmpeg').trim();if(/[\r\n\0]/.test(c.ffmpegPath))throw new Error('FFmpeg 路径无效');
 if(c.downloadCacheMB<c.downloadMaxMB*2)throw new Error('缓存总容量至少为单视频大小上限的两倍，用于音视频合并');
 if(!['all','allow','deny'].includes(c.groupMode))throw new Error('群聊范围无效');
 for(const k of ['groupIds','blockedUsers']){c[k]=String(c[k]||'').trim();if(c[k]&&!/^[\d\s,，;；]+$/.test(c[k]))throw new Error(`${k} 只能填写数字账号和分隔符`);}
 c.cookie=String(c.cookie||'').trim().replace(/^cookie:\s*/i,'');if(/[\r\n]/.test(c.cookie))throw new Error('Cookie 必须为单行');
 return c;
}
export const ids=s=>new Set(String(s).split(/[\s,，;；]+/).filter(Boolean));
