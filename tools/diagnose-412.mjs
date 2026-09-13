// Run on the NapCat server. No QQ messages and no media downloads.
import fs from 'node:fs/promises';
import path from 'node:path';
import {ConnectionCheck} from '../lib/diagnostics.mjs';
import {SessionStore} from '../lib/cookies.mjs';
import {RequestGate} from '../lib/net.mjs';
import {normalize} from '../lib/config.mjs';
import {makeDm} from '../lib/wbi.mjs';
import {traceLine} from '../lib/trace.mjs';
const args=process.argv.slice(2),input=args.shift();
const options={};for(let i=0;i<args.length;i+=2){if(!['--config','--data-path','--mode','--output','--interface'].includes(args[i])||!args[i+1])throw new Error('参数格式无效');options[args[i]]=args[i+1];}
if(!input){console.error('用法：node tools/diagnose-412.mjs BV号 [--config NapCat配置文件路径] [--data-path 插件数据目录] [--mode anonymous|session|both] [--interface wbi|legacy] [--output bili-412-diagnostic.json]');process.exitCode=1;}
else{
 let check;
 try{
  const configFile=options['--config']?path.resolve(options['--config']):null;
  const config=normalize(configFile?JSON.parse(await fs.readFile(configFile,'utf8')):{});if(options['--interface']){if(!['wbi','legacy'].includes(options['--interface']))throw new Error('接口选项无效');config.playurlMode=options['--interface'];}
  const mode=options['--mode']||(configFile?'session':'anonymous');if(mode!=='anonymous'&&!configFile)throw new Error('会话测试需要 --config；不要把 Cookie 写在命令行中');
  const root=options['--data-path']?path.resolve(options['--data-path']):path.join(configFile?path.dirname(configFile):process.cwd(),'bili-recognizer-data');
  const session=new SessionStore(root,config.cookie);await session.init();session.dm||=makeDm();const traces=[];
  const state={config,session,gate:new RequestGate(()=>config),onTrace:r=>{if(r.phase!=='REQUEST')traces.push(r);console.error(traceLine(r));}};
  check=new ConnectionCheck(()=>state);check.start(input,mode);await check.task;
  const report={environment:{node:process.version,platform:process.platform,source:'server-cli',sessionFileLoaded:session.loaded,playurlMode:config.playurlMode},report:check.report,traces,risk:state.gate.snapshot()};
  const output=path.resolve(options['--output']||'bili-412-diagnostic.json');await fs.writeFile(output,JSON.stringify(report,null,2),{mode:0o600});console.log('诊断结果已保存：'+output);
  if(check.report.rows.some(r=>!['ok','anonymous'].includes(r.status)))process.exitCode=2;
 }catch(e){console.error('自检未完成：'+(e.code||e.name)+'。请检查参数、配置路径和文件权限。');process.exitCode=1;}finally{await check?.close();}
}
