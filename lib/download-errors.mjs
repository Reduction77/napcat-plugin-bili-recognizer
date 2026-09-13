const known=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','ENOSPC','EACCES','EPERM','EIO','ENOENT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_RES_CONTENT_LENGTH_MISMATCH','MEDIA_TRUNCATED','LIMIT','BACKOFF','CANCELLED','MEDIA_URL','STREAM','403','404','408','412','429','500','502','503','504']);
export function errorSummary(error){
 const chain=[],seen=new Set();for(let e=error;e&&typeof e==='object'&&!seen.has(e)&&chain.length<5;e=e.cause){seen.add(e);chain.push(e);}
 const code=e=>known.has(String(e?.code))?String(e.code):null;
 const frames=[...String(error?.stack||'').matchAll(/\/(downloads|media-url|download-errors|net)\.mjs:(\d+):(\d+)/g)].slice(0,4).map(m=>`${m[1]}.mjs:${m[2]}:${m[3]}`);
 return {name:['TypeError','Error','AbortError','TimeoutError','RangeError','BiliError'].includes(error?.name)?error.name:'Error',code:code(error),causeCode:chain.slice(1).map(code).find(Boolean)||null,kind:error?.message==='terminated'?'TERMINATED':error?.message==='fetch failed'?'FETCH_FAILED':'OTHER',frames};
}
export function retryableMediaError(e){
 const d=e.downloadDiagnostic;if(!d||!['connect','read_body','response'].includes(d.stage))return false;
 return ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_RES_CONTENT_LENGTH_MISMATCH','MEDIA_TRUNCATED','408','500','502','503','504'].includes(d.causeCode||d.code)||['TERMINATED','FETCH_FAILED'].includes(d.kind);
}
export function detailedDownloadError(e){
 const d=e.downloadDiagnostic||errorSummary(e),code=d.causeCode||d.code||d.name;
 if(['ENOSPC','EACCES','EPERM','EIO'].includes(code))return `服务器文件写入失败（${code}），请检查磁盘空间与下载目录权限。`;
 if(d.name==='AbortError'||d.name==='TimeoutError')return '下载已取消或超时。';
 const labels={connect:'连接视频节点失败',response:'视频节点响应异常',read_body:'读取视频数据失败',file_open:'创建下载文件失败',file_write:'写入下载文件失败',file_close:'关闭下载文件失败'};
 return `${labels[d.stage]||'下载处理失败'}（${code}）${d.attempt?'，已请求 '+d.attempt+' 次'+(d.addressCount?'，共 '+d.addressCount+' 个可用地址':''):''}。请在「视频下载」任务旁打开「错误详情」。`;
}
