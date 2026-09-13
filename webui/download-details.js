'use strict';
window.BiliDownloadDetails=(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const quality=q=>({16:'360P',32:'480P',64:'720P',80:'1080P'}[q]||'未知');
 function render(job,open=false){
  if(!job.error&&!job.failure)return '';
  const f=job.failure,stage={connect:'连接节点',response:'检查响应',read_body:'读取视频数据',file_open:'创建下载文件',file_write:'写入文件',file_close:'关闭文件',processing:'下载处理'};
  const entries=f?[['失败阶段',stage[f.stage]||f.stage||'未知'],['底层错误',f.causeCode||f.code||f.name||'未知'],['HTTP 状态',f.httpStatus??'—'],['视频节点',f.host||'—'],['已接收数据',f.receivedBytes===undefined?'—':`${f.receivedBytes} 字节（${(f.receivedBytes/1048576).toFixed(2)} MB）`],['请求次数',f.attempt??'—'],['可用地址数',f.addressCount??'旧任务未记录'],['当前地址尝试',f.addressAttempt===undefined?'旧任务未记录':`${f.addressAttempt} / 3`]]:[];
  return `<details class="download-failure" data-job="${esc(job.id)}"${open?' open':''}><summary>错误详情</summary>${f?`<dl>${entries.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`:'<p>这条旧任务没有详细记录，请重新下载后查看。</p>'}<button class="button download-diagnostic-export" data-id="${esc(job.id)}">导出此任务诊断</button></details>`;
 }
 return {render,quality};
})();
