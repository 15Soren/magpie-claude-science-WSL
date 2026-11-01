import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const api=await import('../src/bridge.js').catch(()=>({}));
const config={model:'codex/gpt-6-luna',displayName:'GPT-6-Luna',gateway:'http://127.0.0.1:3425',key:'magpie-claude-science',token:'test-local-only'};
test('catalog offers Science-compatible shell IDs with true display names',()=>{
  assert.equal(typeof api.catalog,'function');
  const data=api.catalog(config);
  assert.equal(data.has_more,false);
  assert.ok(data.data.every(x=>x.id.startsWith('claude-')));
  assert.ok(data.data.some(x=>x.display_name.includes('GPT-6-Luna')));
});
test('catalog preserves distinct models and their Magpie capabilities',()=>{
  const models=[{id:'one/a',display_name:'First',max_input_tokens:123456,max_output_tokens:1234,reasoning:true,reasoning_levels:['low','high'],modalities:{input:['text','image']},tool_call:true},{id:'two/b',max_input_tokens:4567,max_output_tokens:321,reasoning:false}];
  const data=api.catalog({...config,models}).data;
  assert.deepEqual(data.map(x=>x.id),models.map(x=>api.modelAlias(x.id)));
  assert.equal(data[0].max_tokens,1234);assert.equal(data[0].max_input_tokens,123456);
  assert.deepEqual(data[0].reasoning_levels,['low','high']);assert.deepEqual(data[0].modalities,{input:['text','image']});
  assert.equal(data[0].capabilities.effort.supported,true);assert.equal(data[1].capabilities.effort.supported,false);
});
test('only loopback Magpie endpoints and real upstream model ids are accepted',()=>{
  assert.equal(typeof api.validateConfig,'function');
  assert.doesNotThrow(()=>api.validateConfig(config));
  for(const gateway of ['https://example.com','http://127.0.0.1.evil:3425','http://user:pass@127.0.0.1:3425','file:///tmp/a']) assert.throws(()=>api.validateConfig({...config,gateway}));
  for(const model of ['','claude-science/a','bad\nmodel']) assert.throws(()=>api.validateConfig({...config,model}));
});
test('selected Science aliases route to their own upstream models',async()=>{
  const seen=[];const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push(JSON.parse(Buffer.concat(chunks)).model);res.setHeader('content-type','application/json');res.end(JSON.stringify({type:'message',model:seen.at(-1),content:[]}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const models=[{id:'one/a'},{id:'two/b'}];const bridge=api.createBridge(()=>({...config,gateway:`http://127.0.0.1:${upstream.address().port}`,models}));await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
  try{for(const m of models){const r=await fetch(`http://127.0.0.1:${bridge.address().port}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':config.token},body:JSON.stringify({model:api.modelAlias(m.id),messages:[],max_tokens:10})});assert.equal(r.status,200);assert.equal((await r.json()).model,api.modelAlias(m.id));}assert.deepEqual(seen,models.map(m=>m.id));}finally{await new Promise(r=>bridge.close(r));await new Promise(r=>upstream.close(r));}
});
test('authenticated bridge forwards tools and counting with real model and preserves streaming',async()=>{
  assert.equal(typeof api.createBridge,'function');
  const seen=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks));seen.push({url:req.url,body,auth:req.headers.authorization,host:req.headers.host});
    if(req.url.includes('count_tokens')){res.setHeader('content-type','application/json');res.end('{"input_tokens":12}');return;}
    res.setHeader('content-type','text/event-stream');
    res.write('event: message_start\ndata: '+JSON.stringify({type:'message_start',message:{model:body.model}})+'\n\n');
    res.end('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n');
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const cfg={...config,gateway:`http://127.0.0.1:${upstream.address().port}`};
  const server=api.createBridge(()=>cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/v1/models')).status,401);
    assert.equal((await fetch(base+'/arbitrary',{headers:{authorization:'Bearer test-local-only'}})).status,404);
    const headers={'authorization':'Bearer test-local-only','content-type':'application/json'};
    const body={model:'claude-sonnet-4-6',stream:true,messages:[{role:'user',content:'hello'}],tools:[{name:'calculate',input_schema:{type:'object'}}]};
    const res=await fetch(base+'/v1/messages',{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(res.status,200);const txt=await res.text();assert.ok(txt.includes('claude-sonnet-4-6'));assert.ok(txt.includes('OK'));
    assert.equal(seen[0].body.model,'codex/gpt-6-luna');assert.deepEqual(seen[0].body.tools,body.tools);
    assert.equal(seen[0].auth,'Bearer magpie-claude-science');
    const counted=await fetch(base+'/v1/messages/count_tokens',{method:'POST',headers,body:JSON.stringify({model:body.model,messages:body.messages})});
    assert.deepEqual(await counted.json(),{input_tokens:12});
    assert.equal(seen[1].body.model,'codex/gpt-6-luna');
    const bad=await fetch(base+'/v1/messages',{method:'POST',headers,body:JSON.stringify({...body,model:'unknown-shell'})});assert.equal(bad.status,400);assert.equal(seen.length,2);
  }finally{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);}
});
