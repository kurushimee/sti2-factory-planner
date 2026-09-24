import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium} from '@playwright/test';
import {arrangeGraph} from '../kernel/graph_layout.js';
const root = resolve(process.env.STI2_WEB_ROOT ?? 'builds/web');
const server = createServer(async (request, response) => {
  if(request.url === '/') { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><title>Layout parity</title>'); return; }
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if(!path.startsWith(root+sep)) { response.writeHead(403); response.end(); return; }
  try { response.setHeader('Content-Type', extname(path)==='.js'?'text/javascript':'application/octet-stream'); response.end(await readFile(path)); }
  catch { response.writeHead(404);response.end(); }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for(const count of [8,72]) {
    const nodes = Array.from({length:count},(_,i)=>({id:String(i),width:280,height:210,ports:[
      {resource:'ore',side:'WEST',x:0,y:100},{resource:'ore',side:'EAST',x:280,y:150}]}));
    const connections = nodes.slice(1).map((n,i)=>({source:String(i),destination:n.id,resource:'ore'}));
    connections.push({source:'6',destination:'2',resource:'ore'});
    const job={nodes,connections,focus:[String(count-1)]};
    const expected=await arrangeGraph(job);
    const actual=await page.evaluate(job=>new Promise((done,reject)=>{
      const worker=new Worker('/kernel/layout-worker.js',{type:'module'});
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Layout Worker timed out.'));},60000);
      worker.onmessage=({data})=>{clearTimeout(timeout);worker.terminate();data.error?reject(new Error(data.error)):done(data.result);};
      worker.onerror=event=>{clearTimeout(timeout);worker.terminate();reject(new Error(event.message));};
      worker.postMessage(job);
    }),job);
    assert.deepEqual(actual,expected);
    console.log(`Native/Worker layout parity passed for ${count} nodes and ${connections.length} routed flows.`);
  }
} finally {await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
