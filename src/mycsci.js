#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.join(os.homedir(),'.config','magpie','claude-science-runtime');
const stateFile=path.join(root,'state.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const args=process.argv.slice(2);
  if(args.length)throw Error('Usage: mycsci');
  let state;
  try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{throw Error('Bridge is not installed. Run node src/cli.js install first.');}
  if(!state.installed||!state.standalone)throw Error('WSL bridge is not installed. Run node src/cli.js install first.');
  const active=spawnSync('systemctl',['--user','is-active','--quiet','ai.magpie.claude-science.service']).status===0;
  const service=spawnSync('systemctl',['--user','start','ai.magpie.claude-science.service'],{encoding:'utf8'});
  if(service.status!==0)throw Error('Cannot start bridge service: '+(service.stderr?.trim()||service.error?.message||'systemctl failed'));
  let ready=false;
  for(let i=0;i<60;i++){
    try{
      const status=JSON.parse(fs.readFileSync(state.statusFile,'utf8'));
      const command=fs.readFileSync(`/proc/${status.pid}/cmdline`,'utf8').split('\0');
      if(status.state==='running'&&command.includes(path.join(state.project,'src','runtime.js'))&&command.includes(stateFile)){
        const health=await fetch(`http://127.0.0.1:${state.sciencePort}/health`,{signal:AbortSignal.timeout(700)});
        const bridge=await fetch(`http://127.0.0.1:${state.bridgePort}/v1/models`,{headers:{'x-api-key':state.token},signal:AbortSignal.timeout(700)});
        if(health.ok&&bridge.ok){ready=true;break;}
      }
    }catch{}
    await sleep(750);
  }
  if(!ready)throw Error('Bridge did not become ready. Check systemctl --user status ai.magpie.claude-science.service and the service logs.');
  try{const response=await fetch(state.gateway+'/api/hello',{signal:AbortSignal.timeout(3000)});if(!response.ok||(await response.json()).name!=='magpie')throw Error();}
  catch{throw Error('Cannot reach the Magpie gateway. Start Windows Magpie and check '+state.gateway);}
  console.error(active?'Claude Science 桥接服务已运行，登录链接如下：':'Claude Science 桥接服务已启动，登录链接如下：');
  const result=spawnSync(state.binary,['url','--config',state.scienceConfig,'--data-dir',state.data],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`Claude Science failed (${result.status??result.signal})`);
}
try{await main();}catch(error){console.error('mycsci: '+error.message);process.exitCode=1;}
