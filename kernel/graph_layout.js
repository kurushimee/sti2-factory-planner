import ELK from 'elkjs/lib/elk.bundled.js';
import {routeGraph} from './graph_routing.js';
import {compactGraph} from './graph_compaction.js';

// Layout uses measured cards and fixed ports. Rates and machine choices are untouched.
export async function arrangeGraph({nodes, connections, focus = [], positions}, elkOptions = {}) {
  if (positions) return {positions, routes: routeGraph(nodes, connections, positions)};
  const local = nodes.filter(node => node.local_to);
  const localIds = new Set(local.map(node => node.id));
  const padding = new Map(local.map(node => [node.local_to, node.height + 96]));
  const core = nodes.filter(node => !localIds.has(node.id)).map(node => ({...node,
    height: node.height + (padding.get(node.id) ?? 0),
  }));
  const elk = new ELK(elkOptions);
  let result;
  try {
    result = await arrangeCore({nodes: core, connections: connections.filter(flow => !localIds.has(flow.source)), focus, elk});
  } finally {
    if (elkOptions.workerFactory) elk.terminateWorker();
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of local) {
    const target = byId.get(node.local_to), p = result.positions[node.local_to];
    result.positions[node.id] = [p[0] + (target.width - node.width) / 2, p[1] + target.height + 48];
  }
  if (local.length || core.length > 60) result.routes = routeGraph(nodes, connections, result.positions);

  return result;
}

async function arrangeCore({nodes, connections, focus, elk}) {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Map(sorted.map((node, index) => [node.id, `n${index}`]));
  const ports = new Map();
  const children = sorted.map(node => ({
    id: ids.get(node.id), width: node.width, height: node.height,
    layoutOptions: {'elk.portConstraints': 'FIXED_POS'},
    ports: node.ports.map((port, index) => {
      const id = `${ids.get(node.id)}p${index}`;
      ports.set(JSON.stringify([node.id, port.side, port.resource]), id);
      return {id, x: port.x, y: port.y, width: 0, height: 0,
        layoutOptions: {'elk.port.side': port.side}};
    }),
  }));
  const flows = [...connections].sort((a, b) =>
    JSON.stringify([a.source, a.destination, a.resource]).localeCompare(
      JSON.stringify([b.source, b.destination, b.resource])));
  const edges = flows.map((flow, index) => {
    const source = ports.get(JSON.stringify([flow.source, 'EAST', flow.resource]));
    const target = ports.get(JSON.stringify([flow.destination, 'WEST', flow.resource]));
    if (!source || !target) throw new Error(`Missing layout port for ${flow.resource}.`);
    return {id: `e${index}`, sources: [source], targets: [target]};
  });
  if (nodes.length > 60 && nodes.length <= 800) {
    const graph = await elk.layout({id: 'factory', children: children.map(node => ({
      id: node.id, width: node.width + 120, height: node.height + 120,
    })), edges: flows.map((flow, index) => ({id: `e${index}`,
      sources: [ids.get(flow.source)], targets: [ids.get(flow.destination)]})),
    layoutOptions: {'elk.algorithm': 'stress', 'elk.randomSeed': '1',
      'elk.stress.desiredEdgeLength': '400', 'elk.stress.iterationLimit': '160'}});
    const goal = graph.children.find(node => node.id === ids.get(focus[0]));
    if (goal) {
      const center = graph.children.reduce((p, node) => [p[0] + node.x, p[1] + node.y], [0, 0]).map(x => x / nodes.length);
      const angle = -Math.atan2(goal.y - center[1], goal.x - center[0]);
      for (const node of graph.children) {
        const x = node.x - center[0], y = node.y - center[1];
        node.x = x * Math.cos(angle) - y * Math.sin(angle);
        node.y = x * Math.sin(angle) + y * Math.cos(angle);
      }
    }
    graph.layoutOptions = {'elk.algorithm': 'sporeOverlap', 'elk.spacing.nodeNode': '0'};
    const separated = await elk.layout(graph);
    separated.layoutOptions = {'elk.algorithm': 'sporeCompaction', 'elk.spacing.nodeNode': '0'};
    const compact = await elk.layout(separated);
    const positions = {};
    for (const node of compact.children) positions[sorted[Number(node.id.slice(1))].id] = [node.x + 80, node.y + 80];
    compactGraph(sorted, flows, positions);
    return {positions, routes: []};
  }
  {
    const graph = await elk.layout({id: 'factory', children, edges, layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1', 'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.thoroughness': '7', 'elk.padding': '[top=50,left=40,bottom=50,right=40]',
    }});
    const positions = {};
    graph.children.forEach((node, index) => { positions[sorted[index].id] = [node.x, node.y]; });
    const routes = graph.edges.map(edge => {
      const flow = flows[Number(edge.id.slice(1))];
      const section = edge.sections?.[0];
      if (!section) throw new Error(`No path for ${flow.resource}.`);
      return {source: flow.source, destination: flow.destination, resource: flow.resource,
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => [p.x, p.y])};
    });
    return {positions, routes, width: graph.width, height: graph.height};
  }
}

