// Keep connected neighborhoods close after rectangle overlap removal has opened
// space. Every accepted move shortens the same port-distance objective.
export function compactGraph(nodes, flows, positions) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const neighbors = new Map(nodes.map(node => [node.id, []]));
  for (const flow of flows) {
    if (flow.source === flow.destination) continue;
    const source = byId.get(flow.source), target = byId.get(flow.destination);
    const output = source.ports.find(p => p.side === 'EAST' && p.resource === flow.resource);
    const input = target.ports.find(p => p.side === 'WEST' && p.resource === flow.resource);
    neighbors.get(source.id).push({id: target.id, dx: input.x - output.x - 100, dy: input.y - output.y});
    neighbors.get(target.id).push({id: source.id, dx: output.x - input.x + 100, dy: output.y - input.y});
  }
  const ordered = [...nodes].sort((a, b) => neighbors.get(b.id).length - neighbors.get(a.id).length || a.id.localeCompare(b.id));
  const gap = 96;
  const collision = (node, point) => nodes.find(other => {
    if (other.id === node.id) return false;
    const p = positions[other.id];
    return point[0] < p[0] + other.width + gap && point[0] + node.width + gap > p[0] &&
      point[1] < p[1] + other.height + gap && point[1] + node.height + gap > p[1];
  });
  for (let round = 0; round < 24; round++) {
    let movement = 0;
    for (const node of round % 2 ? [...ordered].reverse() : ordered) {
      const adjacent = neighbors.get(node.id);
      if (!adjacent.length) continue;
      const targets = adjacent.map(n => [positions[n.id][0] + n.dx, positions[n.id][1] + n.dy]);
      const target = targets.reduce((p, q) => [p[0] + q[0], p[1] + q[1]], [0, 0]).map(x => x / targets.length);
      const cost = p => targets.reduce((sum, q) => sum + (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2, 0);
      const old = positions[node.id];
      let best = old, bestCost = cost(old);
      const candidates = [target, [target[0], old[1]], [old[0], target[1]], [(target[0] + old[0]) / 2, (target[1] + old[1]) / 2]];
      const visited = new Set();
      for (let attempt = 0; candidates.length && attempt < 64;) {
        candidates.sort((a, b) => cost(a) - cost(b));
        const point = candidates.shift(), key = point.map(Math.round).join(',');
        if (visited.has(key)) continue;
        visited.add(key);
        attempt++;
        if (cost(point) >= bestCost) continue;
        const other = collision(node, point);
        if (!other) { best = point; bestCost = cost(point); break; }
        const p = positions[other.id];
        candidates.push([p[0] - node.width - gap, point[1]], [p[0] + other.width + gap, point[1]],
          [point[0], p[1] - node.height - gap], [point[0], p[1] + other.height + gap]);
      }
      movement += Math.hypot(best[0] - old[0], best[1] - old[1]);
      positions[node.id] = best;
    }
    if (movement < 1) break;
  }
  for (const node of nodes) {
    const adjacent = neighbors.get(node.id);
    if (adjacent.length !== 1 || !/^(goal|surplus):/.test(node.id)) continue;
    const neighbor = adjacent[0], p = positions[neighbor.id];
    const target = [p[0] + neighbor.dx, p[1] + neighbor.dy];
    const xs = new Set([target[0]]), ys = new Set([target[1]]);
    for (const other of nodes) {
      if (other.id === node.id) continue;
      const q = positions[other.id];
      xs.add(q[0] - node.width - gap); xs.add(q[0] + other.width + gap);
      ys.add(q[1] - node.height - gap); ys.add(q[1] + other.height + gap);
    }
    const nearest = (values, index) => [...values].sort((a, b) => Math.abs(a-target[index])-Math.abs(b-target[index])).slice(0, 40);
    const candidates = nearest(xs, 0).flatMap(x => nearest(ys, 1).map(y => [x, y]));
    candidates.sort((a, b) => Math.hypot(a[0]-target[0], a[1]-target[1])-Math.hypot(b[0]-target[0], b[1]-target[1]));
    const chosen = candidates.find(point => !collision(node, point));
    if (chosen) positions[node.id] = chosen;
  }
  const left = Math.min(...Object.values(positions).map(p => p[0])) - 80;
  const top = Math.min(...Object.values(positions).map(p => p[1])) - 80;
  for (const p of Object.values(positions)) { p[0] -= left; p[1] -= top; }
}
