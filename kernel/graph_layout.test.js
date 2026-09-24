import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeGraph} from './graph_layout.js';
import {routeGraph} from './graph_routing.js';

const node = (id, width = 275, height = 190) => ({id, width, height, ports: [
  {side: 'WEST', resource: 'ore', x: 0, y: 80},
  {side: 'EAST', resource: 'ore', x: width, y: 140},
]});
const edge = (source, destination) => ({source, destination, resource: 'ore'});

function verify(nodes, connections, result) {
  assert.equal(Object.keys(result.positions).length, nodes.length);
  assert.equal(result.routes.length, connections.length);
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], [ax, ay] = result.positions[a.id];
    assert.ok(Number.isFinite(ax) && Number.isFinite(ay));
    for (const b of nodes.slice(i + 1)) {
      const [bx, by] = result.positions[b.id];
      assert.ok(ax + a.width <= bx || bx + b.width <= ax || ay + a.height <= by || by + b.height <= ay,
        `Overlapping cards: ${a.id}, ${b.id}`);
    }
  }
  for (const route of result.routes) {
    const source = nodes.find(n => n.id === route.source), target = nodes.find(n => n.id === route.destination);
    for (const [n, side, p] of [[source, 'EAST', route.points[0]], [target, 'WEST', route.points.at(-1)]]) {
      const port = n.ports.find(p => p.side === side && p.resource === route.resource);
      assert.ok(Math.abs(p[0] - result.positions[n.id][0] - port.x) < 0.01);
      assert.ok(Math.abs(p[1] - result.positions[n.id][1] - port.y) < 0.01);
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      assert.ok(a[0] === b[0] || a[1] === b[1], 'A connection must remain orthogonal.');
      for (const n of nodes) {
        const [x, y] = result.positions[n.id];
        const intersects = a[0] === b[0]
          ? a[0] > x + 0.01 && a[0] < x + n.width - 0.01 && Math.max(a[1], b[1]) > y + 0.01 && Math.min(a[1], b[1]) < y + n.height - 0.01
          : a[1] > y + 0.01 && a[1] < y + n.height - 0.01 && Math.max(a[0], b[0]) > x + 0.01 && Math.min(a[0], b[0]) < x + n.width - 0.01;
        assert.ok(!intersects, `Connection ${route.source} -> ${route.destination} enters ${n.id}.`);
      }
    }
  }
}

test('branching and recycling retain all fixed ports with deterministic paths', async () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => node(id));
  const connections = [edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('c', 'd'), edge('a', 'e')];
  const result = await arrangeGraph({nodes, connections, focus: ['d']});
  verify(nodes, connections, result);
  const reversed = await arrangeGraph({nodes: [...nodes].reverse(), connections: [...connections].reverse(), focus: ['d']});
  assert.deepEqual(result, reversed);
});

test('a large shared factory keeps local branches compact without row folding', async () => {
  const nodes = Array.from({length: 72}, (_, i) => node(String(i), 230 + i % 3 * 20, 150 + i % 5 * 20));
  const connections = [];
  for (let i = 0; i < 72; i++) {
    if (i % 6) connections.push(edge(String(i - 1), String(i)));
    if (i >= 6 && i % 6 === 2) connections.push(edge(String(i - 6), String(i)));
  }
  const result = await arrangeGraph({nodes, connections, focus: ['71']});
  verify(nodes, connections, result);
  const spans = connections.map(e => Math.hypot(...result.positions[e.source].map((p, i) => p - result.positions[e.destination][i])));
  assert.ok(Math.max(...spans) < 3500);
  assert.ok(spans.reduce((a, b) => a + b, 0) / spans.length < 1100);
  assert.deepEqual(result, await arrangeGraph({nodes: [...nodes].reverse(), connections: [...connections].reverse(), focus: ['71']}));
});

test('local external electricity is a short visible link, not a factory-wide hub', async () => {
  const nodes = [node('machine'), {...node('supply', 170, 150), local_to: 'machine'}];
  const connections = [edge('supply', 'machine')];
  const result = await arrangeGraph({nodes, connections});
  verify(nodes, connections, result);
  assert.ok(result.routes[0].points.reduce((sum, p, i, all) => i ? sum + Math.hypot(p[0] - all[i-1][0], p[1] - all[i-1][1]) : 0, 0) < 1000);
});

test('routing follows clear space around an intervening card', () => {
  const nodes = [node('a'), node('b'), node('obstacle', 300, 600)];
  const positions = {a: [100, 300], b: [1100, 300], obstacle: [580, 100]};
  const connections = [edge('a', 'b')];
  verify(nodes, connections, {positions, routes: routeGraph(nodes, connections, positions)});
});

test('missing ports fail explicitly instead of dropping a connection', async () => {
  await assert.rejects(arrangeGraph({nodes: [node('a'), node('b')], connections: [{...edge('a', 'b'), resource: 'missing'}]}), /Missing layout port/);
});
