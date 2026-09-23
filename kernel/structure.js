const positionKey = value => `${value.dimension}|${value.x}|${value.y}|${value.z}`;

export function structurePosition(origin, facing, position) {
  const [x, y, z] = position;
  const offsets = {2: [-x, y, z], 3: [x, y, -z], 4: [z, y, x], 5: [-z, y, -x]};
  const offset = offsets[facing];
  if (!offset) throw new Error('The controller has no supported horizontal facing.');
  return {...origin, x: origin.x + offset[0], y: origin.y + offset[1], z: origin.z + offset[2]};
}

export function associateStructures(imported, dataset, stateAt) {
  const definitions = new Map((dataset.machines ?? []).map(machine => [machine.id, machine]));
  const parts = new Map(imported.parts.map(part => [positionKey(part.origin), part]));
  const candidates = new Map();
  for (const machine of imported.machines) {
    const shapes = definitions.get(machine.id)?.shapes;
    if (!shapes?.length) continue;
    const shape = shapes.find(value => value.index === (machine.shape ?? 0));
    const report = {status: 'unresolved', evidence: 'Deduced from saved block states and captured shape rules.', hatches: [], problems: []};
    machine.structure = report;
    if (!shape) { report.problems.push({reason: 'The selected shape has no captured template.'}); continue; }
    try {
      for (const cell of shape.cells) {
        const origin = structurePosition(machine.origin, machine.facts.facingDirection, cell.position);
        const part = parts.get(positionKey(origin));
        if (part && cell.allowed_hatches.includes(part.hatch_type)) { report.hatches.push(part.origin); continue; }
        const rule = Number.isInteger(cell.member_rule) ? dataset.shape_member_rules?.[cell.member_rule] : cell.member_rule;
        if (!rule?.state_only_verified) { report.problems.push({origin, reason: 'This shape member requires an unsupported predicate.'}); continue; }
        const state = stateAt(origin);
        if (!state) { report.problems.push({origin, reason: 'The required block state is unavailable.'}); continue; }
        const hasDirection = Object.keys(state.Properties ?? {}).some(key => ['facing', 'axis', 'rotation', 'north', 'east', 'south', 'west', 'shape'].includes(key));
        const facing = machine.facts.facingDirection;
        const rotated = rule.matching_world_states?.[facing];
        if (hasDirection && facing !== 3 && !rotated) {
          report.problems.push({origin, reason: 'This directional member has no verified world-state rotation.'}); continue;
        }
        const matching = (facing === 3 ? rule.matching_states : rotated ?? rule.matching_states).filter(value => value.Name === state.Name);
        if (!matching.some(value => Object.entries(value.Properties ?? {}).every(([key, expected]) => state.Properties?.[key] === expected))) {
          report.problems.push({origin, reason: 'The saved block does not match the captured shape.', block: state.Name});
        }
      }
      if (!report.problems.length) {
        report.status = 'matching_saved_geometry';
        for (const origin of report.hatches) {
          const key = positionKey(origin);
          if (!candidates.has(key)) candidates.set(key, []);
          candidates.get(key).push(machine);
        }
      }
    } catch (error) { report.problems.push({reason: error.message}); }
  }
  for (const [key, controllers] of candidates) {
    const part = parts.get(key);
    if (controllers.length > 1) {
      part.controller_candidates = controllers.map(machine => machine.origin);
      for (const machine of controllers) {
        machine.structure.status = 'ambiguous_shared_hatch';
        machine.structure.problems.push({origin: part.origin, reason: 'More than one matching controller can claim this hatch.'});
      }
    }
  }
  for (const [key, controllers] of candidates) {
    if (controllers.length !== 1 || controllers[0].structure.status !== 'matching_saved_geometry') continue;
    const part = parts.get(key);
    part.controller = controllers[0].origin;
    part.association_evidence = 'unique_matching_saved_geometry';
  }
}
