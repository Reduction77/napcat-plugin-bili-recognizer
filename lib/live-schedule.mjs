// All daily windows use Beijing time, independently of the server's timezone.
export const scheduleDefaults={scheduleEnabled:false,startTime:'18:00',endTime:'23:00',continueUntilEnd:true,control:'auto'};
const minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
export const scheduleWindows=d=>d.windows===undefined?[{startTime:d.startTime||'18:00',endTime:d.endTime||'23:00'}]:d.windows;
export function validateSchedule(raw){
 const d={...scheduleDefaults,...raw};
 if(typeof d.scheduleEnabled!=='boolean'||typeof d.continueUntilEnd!=='boolean'||!['auto','manual','stopped'].includes(d.control))throw new Error('检测设置格式错误。');
 const windows=scheduleWindows(d);
 if(!Array.isArray(windows)||windows.length>12||(!windows.length&&d.scheduleEnabled))throw new Error('启用时段限制时至少设置一段，最多支持 12 个时间段。');
 d.windows=windows.map(w=>{
  if(!w||typeof w!=='object'||Array.isArray(w))throw new Error('时间段格式错误。');
  for(const k of ['startTime','endTime'])if(typeof w[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w[k]))throw new Error('请输入有效的 HH:MM 时间。');
  if(w.startTime===w.endTime)throw new Error('同一时段的开始和结束不能相同；全天检测请关闭时段限制。');
  return {startTime:w.startTime,endTime:w.endTime};
 });
 // Retain the first window as legacy fields for old configuration readers.
 if(d.windows.length)Object.assign(d,d.windows[0]);
 return d;
}
export function liveWindow(d,now=Date.now()){
 if(!d.scheduleEnabled)return {inside:true,nextOpenAt:0};
 const local=new Date(now+8*3600000),current=local.getUTCHours()*60+local.getUTCMinutes();let nextOpenAt=Infinity;
 for(const w of scheduleWindows(d)){
  const start=minute(w.startTime),end=minute(w.endTime);
  if(start<end?current>=start&&current<end:current>=start||current<end)return {inside:true,nextOpenAt:0};
  const delta=(start-current+1440)%1440;
  nextOpenAt=Math.min(nextOpenAt,now-local.getUTCSeconds()*1000-local.getUTCMilliseconds()+delta*60000);
 }
 return {inside:false,nextOpenAt:Number.isFinite(nextOpenAt)?nextOpenAt:0};
}
export function detectionReason(d,sub,now=Date.now()){
 if(!d.enabled)return 'disabled';if(d.control==='stopped')return 'stopped';if(!sub.enabled)return 'subscription_paused';
 if(d.control==='manual'&&d.manualTargets?.includes(sub.uid))return 'manual';
 if(liveWindow(d,now).inside)return 'window';
 if(d.continueUntilEnd&&d.states[sub.uid]?.phase==='live')return 'following';
 return 'outside_window';
}
export const detecting=reason=>['manual','window','following'].includes(reason);
