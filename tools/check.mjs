// Optional network diagnosis on the actual server; never sends a QQ message.
import {BiliClient,formatInfo,publicError} from '../lib/bili.mjs';
import {extract} from '../lib/parser.mjs';
import {defaults} from '../lib/config.mjs';
const links=extract(process.argv.slice(2).join(' '));
if(!links.length){console.error('用法：node tools/check.mjs "B站链接或BV号"');process.exitCode=1;}
else {const client=new BiliClient(defaults);try{for(const input of links.slice(0,2)){const link=await client.resolve(input);console.log(formatInfo(await client.info(link),defaults));}}catch(e){console.error(`检查失败：${publicError(e)} 错误码：${e.code||e.name}`);process.exitCode=1;}finally{client.close();}}
