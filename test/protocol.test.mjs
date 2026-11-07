import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('built server handles real stdio calls, schema errors and private URLs', async () => {
  const transport = new StdioClientTransport({ command:process.execPath, args:[fileURLToPath(new URL('../dist/src/server.mjs',import.meta.url)),'--offline'],stderr:'pipe' });
  const client=new Client({name:'prototype-regression',version:'1.0.0'});
  try {
    await client.connect(transport);
    const { tools }=await client.listTools();
    assert.equal(tools.length,3);
    for(const t of tools) assert.equal(t.annotations.readOnlyHint,true);
    for(const args of [{ query:' ' },{query:'launch',kind:'banana'},{query:'launch',free:'false'}]) {
      const result=await client.callTool({name:'search_skills',arguments:args});
      assert.equal(result.isError,true);
    }
    for(const product_url of ['file:///etc/passwd','http://name:pass@127.0.0.1/','https://example.test/?secret=1']) {
      const result=await client.callTool({name:'recommend',arguments:{job:'a launch video',product_url}});
      assert.equal(result.isError,true);
    }
    const result=await client.callTool({name:'search_skills',arguments:{query:'launch',free:false}});
    assert.ok(result.structuredContent.results.length>0);
    assert.ok(result.structuredContent.results.every((s)=>s.free===false));
    assert.equal(result.content[0].text,JSON.stringify(result.structuredContent,null,2));
    const unknown=await client.callTool({name:'get_skill',arguments:{slug:'missing-skill'}});
    assert.equal(unknown.structuredContent.found,false);
    const traversal=await client.callTool({name:'get_skill',arguments:{slug:'../account'}});
    assert.equal(traversal.isError,true);
  } finally { await client.close(); }
});
