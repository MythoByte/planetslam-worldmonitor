import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {callLLM}=createRequire(import.meta.url)('../scripts/lib/llm-chain.cjs');
test('Cyber can disable OpenRouter reasoning within its output budget; other caller defaults retain the original request',async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY,oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY='synthetic-test-key';const bodies=[];
 globalThis.fetch=async(url,options)=>{if(String(url).includes('openrouter.ai/'))bodies.push(JSON.parse(options.body));return Response.json({choices:[{finish_reason:'stop',message:{content:'{"items":[]}'}}],usage:{total_tokens:1}});};
 try{
  await callLLM('Synthetic system','Synthetic evidence',{allowedProviders:['openrouter'],modelOverrides:{openrouter:'synthetic-model'},disableReasoning:true,maxTokens:1000});
  await callLLM('Synthetic system','Synthetic evidence',{allowedProviders:['openrouter'],modelOverrides:{openrouter:'synthetic-model'},maxTokens:1000});
  assert.deepEqual(bodies[0].reasoning,{enabled:false});assert.equal(bodies[0].max_tokens,1000);assert.equal('reasoning' in bodies[1],false);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;}
});
