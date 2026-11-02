#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {emitKeypressEvents} from 'node:readline';
import {enabledSciencePlugins} from './plugin-identity.js';
import {makeTicket} from './ticket.js';
import {managedWrite,restoreAll} from './files.js';
import {scienceConfig,checkOriginalConfig,launchPlist,systemdUnit,label} from './setup.js';
import {parseArgs,help,resolveGateway,selectModel,discoverBinary,reservePorts} from './config.js';
import {stageDeployment,verifyDeployment,validateNodeLibraries} from './deployment.js';
import {modelAlias,validateConfig} from './bridge.js';
const sourceProject=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>{try{return fs.readFileSync(file,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
const json=file=>JSON.parse(read(file)||'null');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function selectModelsTui(models,previous,{input=process.stdin,output=process.stdout}={}){
  const chosen=new Set(previous), ids=new Set(models.map(m=>m.id));for(const id of chosen)if(!ids.has(id))chosen.delete(id);
  let cursor=0,lines=0;const height=Math.max(3,Math.min(15,(output.rows||24)-5));
  const render=()=>{if(lines)output.write(`\x1b[${lines}A\x1b[J`);const start=Math.max(0,Math.min(cursor-Math.floor(height/2),models.length-height));const view=models.slice(start,start+height);const rows=['Select models: ↑/↓ move, space toggle, enter confirm, q cancel',...view.map((m,i)=>`${start+i===cursor?'>':' '} [${chosen.has(m.id)?'x':' '}] ${m.display_name||m.id} (${m.id})`),`${chosen.size} selected · ${start+1}-${start+view.length}/${models.length}`];output.write(rows.join('\n')+'\n');lines=rows.length;};
  return await new Promise((resolve,reject)=>{const old=input.isRaw;const finish=(error)=>{input.off('keypress',onKey);input.setRawMode(Boolean(old));input.pause();output.write('\x1b[?25h');error?reject(error):resolve([...chosen]);};const onKey=(str,key={})=>{if(key.ctrl&&key.name==='c'||key.name==='q')return finish(Error('Model selection cancelled'));if(key.name==='up')cursor=(cursor+models.length-1)%models.length;else if(key.name==='down')cursor=(cursor+1)%models.length;else if(key.name==='space'){const id=models[cursor].id;chosen.has(id)?chosen.delete(id):chosen.add(id);}else if(key.name==='return'){if(chosen.size)return finish();}render();};emitKeypressEvents(input);input.setRawMode(true);input.resume();input.on('keypress',onKey);output.write('\x1b[?25l');render();});
}
function defaultRun(bin,args,allowFailure=false){const r=spawnSync(bin,args,{encoding:'utf8',timeout:45000,env:{...process.env,MAGPIE_NO_STATS:'1'}});if(!allowFailure&&(r.status!==0||r.error))throw Error(`${path.basename(bin)} ${args[0]} failed: ${r.error?.message||r.stderr?.trim()||r.stdout?.trim()}`);return r;}

export function createInstaller(deps={}) {
  const home=deps.home||os.homedir(), project=deps.project||sourceProject,env=deps.env||process.env;
  const platform=deps.platform||process.platform, wsl=platform==='linux'&&(deps.wsl??Boolean(env.WSL_DISTRO_NAME));
  const root=path.join(home,'.config','magpie','claude-science-runtime');
  const configRoot=path.dirname(root);
  const stateFile=path.join(root,'state.json'),privateJournal=path.join(root,'private-journal.json'),installJournal=path.join(root,'install-journal.json');
  const plist=wsl?path.join(home,'.config','systemd','user',label+'.service'):path.join(home,'Library','LaunchAgents',label+'.plist'),domain=`gui/${process.getuid?.()??0}`;
  const run=deps.run||defaultRun,fetcher=deps.fetch||fetch,log=deps.log||console.log;
  const save=(file,content)=>managedWrite(file,content,privateJournal);
  const commandPath=path.join(home,'.local','bin','mycsci'),commandJournal=path.join(root,'command-journal.json');
  function registerCommand(){
    if(fs.existsSync(commandPath)&&!json(commandJournal)?.entries?.some(entry=>entry.file===commandPath))throw Error('Refusing to overwrite existing command: '+commandPath);
    managedWrite(commandPath,fs.readFileSync(path.join(project,'src','mycsci.js')),commandJournal);
    fs.chmodSync(commandPath,0o700);
  }
  const ownedManager=state=>{const status=json(state.statusFile);if(!status?.pid)return false;const command=run('/bin/ps',['-p',String(status.pid),'-o','command='],true).stdout||'';return command.includes(path.join(state.project,'src','runtime.js'))&&command.includes(stateFile);};
  const stop=deps.stopService|| (async state=>{
    if(wsl)run('systemctl',['--user','stop',label+'.service'],true);
    else run('/bin/launchctl',['bootout',domain+'/'+label],true);
    for(let i=0;i<150;i++){if(!ownedManager(state))return;await sleep(100);}
    throw Error('Managed service did not stop; leaving files intact. Inspect doctor before retrying.');
  });
  const healthy=deps.waitHealthy|| (async state=>{
    for(let i=0;i<60;i++){
      const status=json(state.statusFile);
      if(status?.state==='running'&&(status.pluginSpec===(state.pluginSpec||state.project)||!state.deployment&&status.pluginSpec===undefined)&&ownedManager(state)){
        try{if((await fetcher(`http://127.0.0.1:${state.sciencePort}/health`,{signal:AbortSignal.timeout(700)})).ok)return;}catch{}
      }
      await sleep(750);
    }
    throw Error('Managed Science startup failed (including possible port collision). Run doctor and inspect service.log.');
  });
  const choose=deps.choose||(process.stdin.isTTY&&process.stdout.isTTY?async ids=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{ids.forEach((id,i)=>log(`${i+1}. ${id}`));const answer=await rl.question('Select model number or catalog ID: ');return ids[Number(answer)-1]||answer.trim();}finally{rl.close();}}:undefined);
  const chooseModels=deps.chooseModels||(process.stdin.isTTY&&process.stdout.isTTY?selectModelsTui:undefined);
  function select(state){const spec=state.pluginSpec||state.project;run(state.magpie,['plugin','add',spec]);run(state.magpie,['plugin','on',spec]);run(state.magpie,['plugin','options',spec,JSON.stringify({agent:'claude-science',model:state.model,gateway:state.gateway})]);run(state.magpie,['claude-science',state.model]);}
  function launch(state){const serviceLog=path.join(root,'service.log');if(!fs.existsSync(serviceLog))save(serviceLog,'');const args={node:state.node,script:path.join(state.project,'src','runtime.js'),state:stateFile,log:serviceLog};managedWrite(plist,wsl?systemdUnit(args):launchPlist(args),installJournal);if(wsl){run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','--now',label+'.service']);}else run('/bin/launchctl',['bootstrap',domain,plist]);}
  async function install(options,previous){
    if(options.command==='install'&&previous&&previous.installed!==false)throw Error('Already prepared. Use upgrade, restart, or uninstall.');
    if(options.command!=='install'&&!previous)throw Error('Not installed. Use install first.');
    const gatewayOverride=options.gateway!==undefined||previous?.gatewayOverride===true;
    const gateway=resolveGateway({gateway:options.gateway||(previous?.gatewayOverride?previous.gateway:undefined),settings:wsl?{}:json(path.join(configRoot,'settings.json'))||{}});
    const response=await fetcher(gateway+'/api/hello',{signal:AbortSignal.timeout(3000)});if(!response.ok||(await response.json()).name!=='magpie')throw Error('Start Magpie before installing');
    const catalog=await fetcher(gateway+'/v1/models',{signal:AbortSignal.timeout(5000)});if(!catalog.ok)throw Error('Cannot read Magpie model catalog');
    const available=(await catalog.json()).data||[];
    const previousModel=json(previous?.agentConfig||path.join(configRoot,'claude-science.json'))?.model||previous?.model;
    let selectedIds;
    if(wsl){
      const old=(previous?.models||[]).map(m=>m.id);if(!old.length&&previousModel)old.push(previousModel);
      if(options.model)selectedIds=options.command==='models'?[...old,options.model]:[options.model];
      else if(options.command==='models'&&!chooseModels)throw Error('Interactive terminal required; use models --model <catalog-id> to add a model');
      else if(chooseModels&&(options.command==='models'||!previous))selectedIds=await chooseModels(available,old);
      else selectedIds=old;
      selectedIds=[...new Set(selectedIds)];if(!selectedIds.length)throw Error('Select at least one model or use --model <catalog-id>');
      for(const id of selectedIds){if(!available.some(m=>m.id===id))throw Error('Model is not in the Magpie catalog: '+id);validateConfig({gateway,model:id,key:'validation',token:'validation'});}
    }else selectedIds=[await selectModel({models:available,requested:options.model,previous:previousModel,choose})];
    const models=selectedIds.map(id=>available.find(m=>m.id===id)),model=selectedIds[0];
    const magpie=wsl?null:discoverBinary('magpie',{explicit:options.magpie||previous?.magpie,env,home}),binary=discoverBinary('science',{explicit:options.science||previous?.binary,env,home});
    let deployment;
    if(options.command==='rollback'){deployment=previous.previousDeployment;if(!deployment)throw Error('No previous deployment available');verifyDeployment(deployment);}
    else deployment=stageDeployment({project,root,node:deps.node||process.execPath});
    // Inspect the actual copied executable (including rollback targets), before stopping any service.
    // Injected service runners use fake binaries and test library validation separately.
    if(!deps.run&&!wsl){const inspected=run('/usr/bin/otool',['-L',deployment.node]);validateNodeLibraries(inspected.stdout);}
    const pluginSpec=deployment.path;
    const oldState=read(stateFile),oldScience=previous?read(previous.scienceConfig):'',oldPlist=read(plist);
    const originalDir=path.join(home,'.claude-science'),originalConfig=path.join(originalDir,'config.toml');
    const baseline=previous&&previous.installed!==false?read(path.join(root,'original-config.txt')):read(originalConfig);
    checkOriginalConfig(baseline,originalDir);
    const registryBefore=json(path.join(configRoot,'plugins.json'));
    const enabledBefore=enabledSciencePlugins(registryBefore,[previous?.pluginSpec,previous?.project]);
    if(previous)await stop(previous);
    let reserved,switched=false;
    try{
      reserved=await reservePorts(options,previous||undefined);
      const state={...(previous||{}),installed:true,project:deployment.path,pluginSpec,node:deployment.node,deployment,
        previousDeployment:previous?.deployment&&previous.deployment.id!==deployment.id?previous.deployment:previous?.previousDeployment,
        magpie,binary,model,models:wsl?models:undefined,gateway,gatewayOverride,standalone:wsl,gatewayKey:env.MAGPIE_GATEWAY_KEY||previous?.gatewayKey||'magpie-claude-science',originalDir,originalConfig,
        agentConfig:path.join(configRoot,'claude-science.json'),pluginsFile:path.join(configRoot,'plugins.json'),
        scienceConfig:path.join(root,'science.toml'),configJournal:path.join(root,'config-journal.json'),statusFile:path.join(root,'status.json'),scienceLog:path.join(root,'science.log'),
        data:previous?.data||path.join(root,'data'),auth:previous?.auth||path.join(root,'auth'),token:previous?.token||randomBytes(32).toString('hex'),...reserved.ports};
      if(!previous||previous.installed===false)save(path.join(root,'original-config.txt'),baseline);
      if(!previous){const t=makeTicket(undefined,state.token);save(path.join(state.auth,'encryption.key'),Object.entries(t.keys).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');save(path.join(state.auth,'.oauth-tokens',t.account+'.enc'),t.encrypted);}
      save(state.scienceConfig,scienceConfig(baseline,{data:state.data,auth:state.auth,port:state.sciencePort,sandboxPort:state.sandboxPort,model:wsl?modelAlias(model):undefined}));
      save(stateFile,JSON.stringify(state,null,2));switched=true;
      if(!wsl){for(const entry of enabledBefore)if(entry.spec!==state.pluginSpec)run(magpie,['plugin','off',entry.spec]);select(state);}
      if(!previous)run(binary,['stop','--data-dir',originalDir]);
      await reserved.release();reserved=null;
      launch(state);await healthy(state);if(wsl)registerCommand();
      log(`${options.command==='rollback'?'Rolled back':options.command==='models'?'Models updated':previous?'Upgraded':'Installed'}. Model: ${model}. ${wsl?'Run claude-science url to open the web UI.':'Open the original Claude Science app.'}`);
      return state;
    }catch(error){
      await reserved?.release();
      if(switched){const failed=json(stateFile);await stop(failed);const restored=restoreAll(failed.configJournal);if(restored.conflicts.length)throw new Error(error.message+'; user config edits preserved: '+restored.conflicts.join(', '));if(!wsl)run(magpie,['plugin','off',failed.pluginSpec],true);}
      if(previous){
        if(switched)save(stateFile,oldState);
        if(read(previous.scienceConfig)!==oldScience)save(previous.scienceConfig,oldScience);
        if(oldPlist&&read(plist)!==oldPlist)managedWrite(plist,oldPlist,installJournal);
        const recovered={...previous,magpie:previous.magpie||magpie,model:previousModel,gateway:previous.gateway||gateway,node:previous.node||deps.node||process.execPath};
        if(previous.installed!==false){
          // Restore the user's actual source instead of resurrecting a removed checkout.
          if(wsl){} else if(registryBefore){
            for(const entry of enabledBefore)run(magpie,['plugin','on',entry.spec]);
            if(enabledBefore.length)run(magpie,['claude-science',previousModel]);
          }else select(recovered);
          launch(recovered);if(wsl||!registryBefore||enabledBefore.length)await healthy(recovered);
        }else{if(!wsl)run(magpie,['claude-science','default'],true);restoreAll(installJournal);}
      }else if(switched){if(wsl){run('systemctl',['--user','disable',label+'.service'],true);}else run(magpie,['claude-science','default'],true);restoreAll(installJournal);if(wsl)run('systemctl',['--user','daemon-reload'],true);restoreAll(privateJournal);}
      throw error;
    }
  }
  async function execute(options){
    if(options.command==='help'){log(help);return;}
    if(options.command==='doctor'){
      const state=json(stateFile);if(!state){log('Local Science service is not initialized. Installing the plugin in Magpie alone does not complete setup.\nKeep Magpie running, then run: node src/cli.js install\nAfter setup succeeds, reopen Claude Science.');return;}
      log(`Runtime: ${state.pluginSpec||state.project}\nModel: ${json(state.agentConfig)?.model||state.model||'(disconnected)'}\nGateway: ${state.gateway||'legacy'}\nService: ${read(state.statusFile)||'(no status)'}\nPrivate logs: ${root}`);
      if(state.deployment){try{verifyDeployment(state.deployment);log('Deployment checksums: OK');}catch(e){log(e.message);}}
      return;
    }
    if(platform!=='darwin'&&!wsl)throw Error('The managed service requires macOS or WSL with systemd');
    if(wsl&&!deps.run)run('systemctl',['--user','show-environment']);
    if(env.XDG_CONFIG_HOME&&path.resolve(env.XDG_CONFIG_HOME)!==path.join(home,'.config'))throw Error('Custom XDG_CONFIG_HOME is not supported');
    // Reject symlink components before creating the lock; journaling starts only while locked.
    for(let current=root;;current=path.dirname(current)){
      try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Refusing symlink: '+current);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(path.dirname(current)===current)break;
    }
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    const lock=path.join(root,'install.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another installer operation or interrupted operation owns install.lock. Inspect before removing the lock; no process will be killed.');throw e;}
    try{
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
      managedWrite(path.join(root,'owner.json'),'{"application":"magpie-claude-science"}\n',privateJournal);
      const state=json(stateFile);
      if(options.command==='models'&&!wsl)throw Error('Model catalog management is available in WSL standalone mode');
      if(['install','models','upgrade','rollback'].includes(options.command))return await install(options,state);
      if(!state){log('Not installed.');return;}
      if(options.command==='register'){if(!wsl||!state.installed||!state.standalone)throw Error('Register requires an installed WSL bridge');registerCommand();log('Registered '+commandPath);return;}
      if(options.command==='restart'){if(state.deployment)verifyDeployment(state.deployment);await stop(state);launch({...state,node:state.node||process.execPath});await healthy(state);log('Restarted.');return;}
      if(options.command==='uninstall'){
        await stop(state);if(wsl)run('systemctl',['--user','disable',label+'.service'],true);const restored=restoreAll(state.configJournal),pl=restoreAll(installJournal);if(wsl)run('systemctl',['--user','daemon-reload']);
        const command=wsl?restoreAll(commandJournal):{conflicts:[]};
        if(restored.conflicts.length||pl.conflicts.length||command.conflicts.length)throw Error('User edits preserved; resolve restore conflicts in journals before removing integration.');
        if(!wsl){const magpie=discoverBinary('magpie',{explicit:options.magpie||state.magpie,env,home});run(magpie,['claude-science','default']);run(magpie,['plugin','rm',state.pluginSpec||state.project]);}
        save(stateFile,JSON.stringify({...state,installed:false},null,2));log('Uninstalled. Sessions and authentication retained at '+state.data);return;
      }
      throw Error('Unknown command: '+options.command);
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  return {execute,stateFile};
}
export async function main(args=process.argv.slice(2),deps){return createInstaller(deps).execute(parseArgs(args));}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
}
