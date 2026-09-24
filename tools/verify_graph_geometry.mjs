import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
const graph = JSON.parse(await readFile(process.argv[2], 'utf8'));
const byId = new Map(graph.nodes.map(n => [n.id, n]));
let segments = 0;
for (const route of graph.routes) {
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i-1], b = route.points[i];
    assert.ok(Math.abs(a[0]-b[0]) < 0.01 || Math.abs(a[1]-b[1]) < 0.01);
    segments++;
    for (const n of graph.nodes) {
      const [x, y] = graph.positions[n.id];
      const hit = Math.abs(a[0]-b[0]) < 0.01
        ? a[0] > x + 0.1 && a[0] < x+n.width-0.1 && Math.max(a[1],b[1]) > y+0.1 && Math.min(a[1],b[1]) < y+n.height-0.1
        : a[1] > y+0.1 && a[1] < y+n.height-0.1 && Math.max(a[0],b[0]) > x+0.1 && Math.min(a[0],b[0]) < x+n.width-0.1;
      assert.ok(!hit, `Route ${route.source} -> ${route.destination} intersects ${n.id}`);
    }
  }
  for (const [id, side, point] of [[route.source,'EAST',route.points[0]], [route.destination,'WEST',route.points.at(-1)]]) {
    const node = byId.get(id), port = node.ports.find(p=>p.side===side&&p.resource===route.resource);
    assert.ok(port);
    assert.ok(Math.abs(point[0]-graph.positions[id][0]-port.x)<1);
    assert.ok(Math.abs(point[1]-graph.positions[id][1]-port.y)<1);
  }
}
const spans = graph.connections.filter(e=>e.resource!=='energy:eu').map(e=>Math.hypot(...graph.positions[e.source].map((p,i)=>p-graph.positions[e.destination][i]))).sort((a,b)=>a-b);
const report = {nodes:graph.nodes.length, connections:graph.connections.length, routed:graph.routes.length, segments, card_intersections:0,
  median_span:spans[Math.floor(spans.length/2)], p95_span:spans[Math.floor(spans.length*.95)], max_span:spans.at(-1)};
assert.equal(report.connections,report.routed);
if(process.argv[3]) await writeFile(process.argv[3],JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
