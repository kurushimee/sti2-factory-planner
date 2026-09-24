// A shared obstacle map keeps routes outside measured cards. Each search is bounded
// by the graph's padded extent; the surrounding margin also carries feedback paths.
export function routeGraph(nodes, connections, positions) {
  try { return routeAtResolution(nodes, connections, positions, 24); }
  catch (error) {
    if (!/No routing clearance|No unobstructed route/.test(error.message)) throw error;
    return routeAtResolution(nodes, connections, positions, 12);
  }
}

function routeAtResolution(nodes, connections, positions, step) {
  if (!nodes.length) return [];
  const margin = 96, clearance = step === 24 ? 10 : 4;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const left = Math.floor((Math.min(...nodes.map(n => positions[n.id][0])) - margin) / step) * step;
  const top = Math.floor((Math.min(...nodes.map(n => positions[n.id][1])) - margin) / step) * step;
  const width = Math.ceil((Math.max(...nodes.map(n => positions[n.id][0] + n.width)) + margin - left) / step) + 1;
  const height = Math.ceil((Math.max(...nodes.map(n => positions[n.id][1] + n.height)) + margin - top) / step) + 1;
  if (width * height > 4000000) throw new Error('The graph is too spread out to route safely.');
  const cells = width * height, blocked = new Uint8Array(cells), usage = new Uint16Array(cells);
  const seen = new Uint32Array(cells * 2), closed = new Uint32Array(cells * 2);
  const costs = new Float64Array(cells * 2), previous = new Int32Array(cells * 2);
  for (const node of nodes) {
    const [x, y] = positions[node.id];
    const x1 = Math.ceil((x - clearance - left) / step), x2 = Math.floor((x + node.width + clearance - left) / step);
    const y1 = Math.ceil((y - clearance - top) / step), y2 = Math.floor((y + node.height + clearance - top) / step);
    for (let row = y1; row <= y2; row++) blocked.fill(1, row * width + x1, row * width + x2 + 1);
  }
  let generation = 0;
  const anchor = (id, side, resource) => {
    const node = byId.get(id), port = node.ports.find(p => p.side === side && p.resource === resource);
    if (!port) throw new Error(`Missing routing port for ${resource}.`);
    return [positions[id][0] + port.x, positions[id][1] + port.y];
  };
  const ordered = connections.map(flow => ({flow,
    start: anchor(flow.source, 'EAST', flow.resource), end: anchor(flow.destination, 'WEST', flow.resource)}));
  ordered.sort((a, b) => distance(a.start, a.end) - distance(b.start, b.end) ||
    JSON.stringify([a.flow.source, a.flow.destination, a.flow.resource]).localeCompare(
      JSON.stringify([b.flow.source, b.flow.destination, b.flow.resource])));
  const routes = [];
  for (const {flow, start, end} of ordered) {
    generation++;
    const sx = Math.ceil((start[0] + clearance + step - left) / step);
    const sy = Math.round((start[1] - top) / step);
    const tx = Math.floor((end[0] - clearance - step - left) / step);
    const ty = Math.round((end[1] - top) / step);
    const source = sy * width + sx, target = ty * width + tx;
    if (blocked[source] || blocked[target]) throw new Error(`No routing clearance for ${flow.resource}.`);
    const heap = new MinHeap();
    const first = source * 2;
    costs[first] = 0; seen[first] = generation; previous[first] = -1;
    heap.push(first, 0);
    let found = -1;
    while (heap.length) {
      const current = heap.pop();
      if (closed[current] === generation) continue;
      closed[current] = generation;
      const cell = current >> 1, x = cell % width, y = Math.floor(cell / width);
      if (cell === target) { found = current; break; }
      for (const [dx, dy, axis] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nextCell = ny * width + nx, next = nextCell * 2 + axis;
        if (blocked[nextCell] || closed[next] === generation) continue;
        const cost = costs[current] + 1 + ((current & 1) === axis ? 0 : 0.8) + Math.min(usage[nextCell], 8) * 0.12;
        if (seen[next] === generation && costs[next] <= cost) continue;
        seen[next] = generation; costs[next] = cost; previous[next] = current;
        heap.push(next, cost + Math.abs(nx - tx) + Math.abs(ny - ty));
      }
    }
    if (found < 0) throw new Error(`No unobstructed route for ${flow.resource}.`);
    const points = [];
    for (let cursor = found; cursor >= 0; cursor = previous[cursor]) {
      const cell = cursor >> 1;
      points.push([left + (cell % width) * step, top + Math.floor(cell / width) * step]);
      usage[cell]++;
    }
    points.reverse();
    points.unshift(start, [points[0][0], start[1]]);
    points.push([points.at(-1)[0], end[1]], end);
    routes.push({...flow, points: simplify(points)});
  }
  return routes.map(({source, destination, resource, points}) => ({source, destination, resource, points}));
}

function distance(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }
function simplify(points) {
  const result = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1), point) < 0.001) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if ((a[0] === b[0] && b[0] === point[0]) || (a[1] === b[1] && b[1] === point[1])) result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}

class MinHeap {
  items = [];
  get length() { return this.items.length; }
  push(id, cost) {
    let index = this.items.length;
    this.items.push([id, cost]);
    while (index) {
      const parent = (index - 1) >> 1;
      if (this.items[parent][1] <= cost) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = [id, cost];
  }
  pop() {
    const result = this.items[0][0], last = this.items.pop();
    if (!this.items.length) return result;
    let index = 0;
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.items.length && this.items[child + 1][1] < this.items[child][1]) child++;
      if (this.items[child][1] >= last[1]) break;
      this.items[index] = this.items[child]; index = child;
    }
    this.items[index] = last;
    return result;
  }
}
