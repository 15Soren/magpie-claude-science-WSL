import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

async function run(command,args,env){
  return await new Promise((resolve,reject)=>{const child=spawn(command,args,{env});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));});
}

test('mycsci starts the user service and prints the managed Science URL',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'mycsci-'));
  const root=path.join(home,'.config','magpie','claude-science-runtime'),bin=path.join(home,'bin'),project=path.join(home,'release');
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(bin);fs.mkdirSync(path.join(project,'src'),{recursive:true});
  const server=http.createServer((req,res)=>{if(req.url==='/api/hello')res.end('{"name":"magpie"}');else if(req.url==='/v1/models'&&Boolean(req.headers['x-api-key']))res.end('{}');else if(req.url==='/health')res.end('{}');else{res.statusCode=401;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,stateFile=path.join(root,'state.json'),statusFile=path.join(root,'status.json');
  const runtime=path.join(project,'src','runtime.js');fs.writeFileSync(runtime,'setInterval(()=>{},1000);');
  const manager=spawn(process.execPath,[runtime,stateFile]);
  try{
    fs.writeFileSync(path.join(bin,'systemctl'),'#!/bin/sh\nif [ "$3" = "--quiet" ]; then exit 1; fi\nexit 0\n',{mode:0o700});
    const science=path.join(bin,'science');fs.writeFileSync(science,'#!/bin/sh\n[ "$1" = url ] || exit 1\nprintf "http://127.0.0.1:1234/example\\n"\n',{mode:0o700});
    fs.writeFileSync(statusFile,JSON.stringify({state:'running',pid:manager.pid}));
    fs.writeFileSync(stateFile,JSON.stringify({installed:true,standalone:true,project,binary:science,scienceConfig:path.join(root,'science.toml'),data:path.join(root,'data'),statusFile,sciencePort:port,bridgePort:port,gateway:`http://127.0.0.1:${port}`,token:'fixture-token'}));
    const result=await run(process.execPath,['src/mycsci.js'],{...process.env,HOME:home,PATH:bin+path.delimiter+process.env.PATH});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/http:\/\/127\.0\.0\.1:1234\/example/);assert.match(result.stderr,/已启动/);
  }finally{manager.kill();await new Promise(resolve=>server.close(resolve));fs.rmSync(home,{recursive:true,force:true});}
});
