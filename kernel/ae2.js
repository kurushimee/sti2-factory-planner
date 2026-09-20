const DIRECTIONS = {down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0]};

export function blockStateAt(chunk, x, y, z) {
  const section = chunk.sections?.find(value => value.Y === Math.floor(y / 16));
  const states = section?.block_states;
  if (!states?.palette?.length) return null;
  if (states.palette.length === 1) return states.palette[0];
  const bits = Math.max(4, Math.ceil(Math.log2(states.palette.length))), perLong = Math.floor(64 / bits);
  const index = ((y % 16 + 16) % 16) * 256 + ((z % 16 + 16) % 16) * 16 + ((x % 16 + 16) % 16);
  const packed = states.data?.[Math.floor(index / perLong)];
  if (packed === undefined) throw new Error('The block-state palette data is truncated.');
  const id = Number((BigInt.asUintN(64, BigInt(packed)) >> BigInt((index % perLong) * bits)) & ((1n << BigInt(bits)) - 1n));
  if (!states.palette[id]) throw new Error('A block-state index is outside its palette.');
  return states.palette[id];
}

function genericStack(value) {
  if (!value?.id) return null;
  const kind = value['#t'] === 'ae2:i' ? 'item' : value['#t'] === 'ae2:f' ? 'fluid' : null;
  if (!kind) throw new Error(`Unsupported AE2 resource type ${value['#t']}.`);
  const amount = Number(value['#']);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('An AE2 pattern quantity is outside the supported range.');
  return {resource: `${kind}:${value.id}`, amount, components: value.components ?? {}};
}

export function readRequester(block, origin) {
  if (block.id !== 'merequester:requester') return null;
  const requests = [];
  for (const [slot, value] of Object.entries(block.requests ?? {})) {
    if (!value.key) continue;
    const entry = {slot: Number(slot), enabled: Boolean(value.state), facts: value};
    try {
      const amount = BigInt(value.amount ?? 0), batch = BigInt(value.batch ?? 0);
      if (amount < 0n || batch < 1n) throw new Error('The requester has an invalid stock target or batch size.');
      const key = genericStack({...value.key, '#': '1'});
      if (!key) throw new Error('The requester key has no resource identity.');
      requests.push({...entry, resource: key.resource, components: key.components,
        stock_target: amount.toString(), crafting_batch: batch.toString(), interpretation: 'quantity', rate: null});
    } catch (error) { requests.push({...entry, unsupported: error.message}); }
  }
  return {id: block.id, origin, requests, facts: block,
    evidence: 'Saved stock targets and crafting batch sizes. No refill interval or production rate is recorded.'};
}

export function decodePatterns(inventory = []) {
  return inventory.map(stack => {
    const result = {slot: stack.Slot, item: stack.id, facts: stack};
    try {
      const processing = stack.components?.['ae2:encoded_processing_pattern'];
      const crafting = stack.components?.['ae2:encoded_crafting_pattern'];
      if (processing) return {...result, kind: 'processing', inputs: processing.sparseInputs.map(genericStack).filter(Boolean), outputs: processing.sparseOutputs.map(genericStack).filter(Boolean)};
      if (crafting) return {...result, kind: 'crafting', recipe_id: crafting.recipeId, substitutions: crafting.canSubstitute, fluid_substitutions: crafting.canSubstituteFluids};
      return {...result, kind: 'unsupported', reason: 'The saved pattern component has no registered adapter.'};
    } catch (error) { return {...result, kind: 'unsupported', reason: error.message}; }
  });
}

export function readProviders(block, origin, state) {
  const providers = [];
  const add = (data, directions, part) => providers.push({origin: {...origin, part},
    patterns: decodePatterns(data.patterns), directions, facts: data,
    adjacent: directions.map(direction => {
      const [dx, dy, dz] = DIRECTIONS[direction];
      return {dimension: origin.dimension, x: origin.x + dx, y: origin.y + dy, z: origin.z + dz};
    })});
  if (block.id === 'ae2:pattern_provider') {
    const direction = state?.Properties?.push_direction;
    add(block, direction && direction !== 'all' && DIRECTIONS[direction] ? [direction] : Object.keys(DIRECTIONS), null);
  }
  if (block.id === 'ae2:cable_bus') {
    for (const direction of Object.keys(DIRECTIONS)) {
      if (block[direction]?.id === 'ae2:cable_pattern_provider') add(block[direction], [direction], direction);
    }
  }
  return providers;
}

export function inferProviderAssignments(imported, recipes = []) {
  const position = origin => `${origin.dimension}|${origin.x}|${origin.y}|${origin.z}`;
  const machines = new Map(imported.machines.map(machine => [position(machine.origin), machine]));
  const byType = new Map();
  for (const recipe of recipes) {
    if (!byType.has(recipe.type)) byType.set(recipe.type, []);
    byType.get(recipe.type).push(recipe);
  }
  for (const provider of imported.providers) {
    provider.adjacent_machines = provider.adjacent.map(origin => machines.get(position(origin))).filter(Boolean).map(machine => machine.origin);
    for (const origin of provider.adjacent_machines) {
      const machine = machines.get(position(origin));
      const candidates = new Set();
      for (const pattern of provider.patterns) {
        if (pattern.kind !== 'processing') continue;
        for (const recipe of byType.get(machine.recipe_type) ?? []) {
          if (recipe.status !== 'normalized' || !recipe.outputs.length) continue;
          const outputs = recipe.outputs;
          if (outputs.some(flow => flow.probability !== 1 || flow.choices.length !== 1)) continue;
          if (pattern.outputs.length !== outputs.length || pattern.inputs.length !== recipe.inputs.length) continue;
          if ([...pattern.inputs, ...pattern.outputs].some(flow => Object.keys(flow.components).length)) continue;
          const first = pattern.outputs.find(flow => flow.resource === outputs[0].choices[0]);
          if (!first) continue;
          const multiplier = first.amount / outputs[0].amount;
          const matches = (flows, expected, index = 0, used = new Set()) => {
            if (index === expected.length) return true;
            const flow = expected[index];
            return flow.probability === 1 && flows.some((value, candidate) => {
              if (used.has(candidate) || !flow.choices.includes(value.resource) || Math.abs(value.amount - flow.amount * multiplier) >= 1e-9) return false;
              return matches(flows, expected, index + 1, new Set([...used, candidate]));
            });
          };
          if (matches(pattern.inputs, recipe.inputs) && matches(pattern.outputs, outputs)) candidates.add(recipe.source_id);
        }
      }
      machine.provider_candidates = [...new Set([...(machine.provider_candidates ?? []), ...candidates])];
    }
  }
  for (const machine of imported.machines) {
    if (!machine.recipe_id && machine.provider_candidates?.length === 1) {
      machine.recipe_id = machine.provider_candidates[0];
      machine.assignment_evidence = 'inferred_from_adjacent_provider';
    } else if (!machine.recipe_id && machine.provider_candidates?.length > 1) {
      machine.assignment_evidence = 'ambiguous_adjacent_patterns';
    }
  }
}
