function fail(path, message) { throw new Error(`${path}: ${message}.`); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
}
function array(value, path) { if (!Array.isArray(value)) fail(path, 'expected a list'); }
function text(value, path) { if (typeof value !== 'string' || !value.length) fail(path, 'expected nonempty text'); }
function number(value, path, minimum = 0, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) fail(path, `expected ${integer ? 'a whole number' : 'a number'} from ${minimum} to ${Number.MAX_SAFE_INTEGER}`);
}
function records(values, path) {
  array(values, path);
  const ids = new Set();
  values.forEach((value, index) => {
    object(value, `${path}[${index}]`);
    text(value.id, `${path}[${index}].id`);
    if (ids.has(value.id)) fail(path, `duplicate ID ${value.id}`);
    ids.add(value.id);
  });
  return ids;
}
function references(values, ids, path) {
  array(values, path);
  for (const id of values) if (typeof id !== 'string' || !ids.has(id)) fail(path, `unknown ID ${String(id)}`);
  if (new Set(values).size !== values.length) fail(path, 'duplicate references');
}

export function validateDataset(dataset) {
  object(dataset, 'dataset');
  if (dataset.format !== 1) fail('dataset.format', 'unsupported version');
  const resources = records(dataset.resources, 'resources');
  for (const resource of dataset.resources) if (resource.max_stack_size !== undefined) number(resource.max_stack_size, `resource ${resource.id}.max_stack_size`, 1, true);
  records(dataset.recipes, 'recipes');
  const machines = records(dataset.machines ?? [], 'machines');
  for (const machine of dataset.machines ?? []) {
    if (machine.availability !== undefined) {
      object(machine.availability, `machine ${machine.id}.availability`);
      if (typeof machine.availability.automatic !== 'boolean' || typeof machine.availability.reason !== 'string') fail(`machine ${machine.id}.availability`, 'needs an automatic flag and a reason');
    }
    if (machine.infrastructure === undefined) continue;
    records(machine.infrastructure, `machine ${machine.id}.infrastructure`);
    for (const variant of machine.infrastructure) {
      number(variant.passive_eu_per_tick, `infrastructure ${variant.id}.passive_eu_per_tick`);
      for (const field of ['max_transfer_eu_per_tick', 'max_axis_distance']) {
        if (variant[field] !== undefined) number(variant[field], `infrastructure ${variant.id}.${field}`);
      }
      if (variant.structure !== undefined) {
        object(variant.structure, `infrastructure ${variant.id}.structure`);
        number(variant.structure.shape, `infrastructure ${variant.id}.structure.shape`, 0, true);
        if (variant.structure.energy_input !== true) fail(`infrastructure ${variant.id}`, 'unsupported structure adapter');
      }
      if (variant.default_energy_hatch !== undefined) references([variant.default_energy_hatch], machines, `infrastructure ${variant.id}.default_energy_hatch`);
    }
  }
  const upgrades = records(dataset.upgrades ?? [], 'upgrades');
  const flows = (values, path, alternatives = false) => {
    array(values, path);
    values.forEach((flow, index) => {
      const at = `${path}[${index}]`;
      object(flow, at);
      number(flow.amount, `${at}.amount`, Number.MIN_VALUE);
      references(alternatives && flow.choices !== undefined ? flow.choices : [flow.resource], resources, at);
      if (flow.returns !== undefined) {
        object(flow.returns, `${at}.returns`);
        const choices = flow.choices ?? [flow.resource];
        for (const [input, returned] of Object.entries(flow.returns)) {
          if (!choices.includes(input)) fail(at, `remainder key ${input} is not an ingredient choice`);
          flows(returned, `${at}.returns.${input}`);
        }
      }
    });
  };
  for (const recipe of dataset.recipes) {
    const at = `recipe ${recipe.id}`;
    references([recipe.primary], resources, `${at}.primary`);
    flows(recipe.inputs, `${at}.inputs`, true);
    flows(recipe.outputs, `${at}.outputs`);
    if (!recipe.outputs.some(flow => flow.resource === recipe.primary)) fail(at, 'primary must be one of the outputs');
    records(recipe.configurations, `${at}.configurations`);
    for (const configuration of recipe.configurations) {
      const location = `${at}, configuration ${configuration.id}`;
      text(configuration.machine, `${location}.machine`);
      machines.add(configuration.machine);
      number(configuration.operations_per_second, `${location}.operations_per_second`, Number.MIN_VALUE);
      for (const field of ['eu_per_operation', 'idle_eu_per_tick']) if (configuration[field] !== undefined) number(configuration[field], `${location}.${field}`);
      if (configuration.build_cost !== undefined) number(configuration.build_cost, `${location}.build_cost`, Number.MIN_VALUE);
      for (const field of ['inputs', 'startup_inputs', 'build_requirements']) if (configuration[field] !== undefined) flows(configuration[field], `${location}.${field}`, field === 'inputs');
      if (configuration.operating_points !== undefined) {
        array(configuration.operating_points, `${location}.operating_points`);
        let previous = -1;
        for (const point of configuration.operating_points) {
          object(point, `${location}.operating_point`);
          number(point.operations_per_second, `${location}.operating_point.operations_per_second`);
          if (point.operations_per_second <= previous || point.operations_per_second > configuration.operations_per_second) fail(location, 'operating points must increase through the supported capacity');
          previous = point.operations_per_second;
          flows(point.inputs, `${location}.operating_point.inputs`, true);
        }
        if (configuration.operating_points[0]?.operations_per_second !== 0 || previous !== configuration.operations_per_second) fail(location, 'operating points must include zero and full capacity');
      }
    }
    if (recipe.process !== undefined) {
      object(recipe.process, `${at}.process`);
      text(recipe.process.type, `${at}.process.type`);
      // Crafting duration belongs to its machine; industrial durations belong to recipes.
      if (recipe.process.type !== 'planner:crafting') {
        number(recipe.process.duration_ticks, `${at}.process.duration_ticks`, 1, true);
        number(recipe.process.eu_per_tick, `${at}.process.eu_per_tick`, 0, true);
      }
    }
    if (recipe.unsupported !== undefined) text(recipe.unsupported, `${at}.unsupported`);
    if (recipe.requires_obtained !== undefined) references(recipe.requires_obtained, resources, `${at}.requires_obtained`);
    if (recipe.catalysts !== undefined) flows(recipe.catalysts, `${at}.catalysts`, true);
    if (recipe.tool_usage !== undefined) {
      object(recipe.tool_usage, `${at}.tool_usage`);
      references([recipe.tool_usage.resource], resources, `${at}.tool_usage.resource`);
      number(recipe.tool_usage.crafts_per_tool, `${at}.tool_usage.crafts_per_tool`, 1, true);
      const inputs = recipe.inputs.filter(flow => flow.resource === recipe.tool_usage.resource);
      if (inputs.length !== 1 || Math.abs(inputs[0].amount - 1 / recipe.tool_usage.crafts_per_tool) > 1e-12) {
        fail(at, 'tool consumption must match one verified lifetime input');
      }
    }
    if (recipe.conditions !== undefined) {
      array(recipe.conditions, `${at}.conditions`);
      for (const condition of recipe.conditions) { object(condition, `${at}.condition`); text(condition.type, `${at}.condition.type`); }
    }
  }
  records(dataset.progression ?? [], 'progression');
  for (const preset of dataset.progression ?? []) {
    text(preset.name, `progression ${preset.id}.name`);
    references(preset.available_machines, machines, `progression ${preset.id}.available_machines`);
    references(preset.available_upgrades, upgrades, `progression ${preset.id}.available_upgrades`);
    if (preset.available_parts) references(preset.available_parts, machines, `progression ${preset.id}.available_parts`);
  }
  for (const machine of dataset.machines ?? []) {
    if (!['supported', 'unsupported', 'structural', 'infrastructure'].includes(machine.status)) fail(`machine ${machine.id}`, 'unknown support status');
    if (machine.status === 'supported') text(machine.mechanic, `machine ${machine.id}.mechanic`);
    if (machine.upgrades !== undefined) references(machine.upgrades, upgrades, `machine ${machine.id}.upgrades`);
    if (machine.shapes !== undefined) {
      array(machine.shapes, `machine ${machine.id}.shapes`);
      const indices = new Set();
      for (const shape of machine.shapes) {
        const at = `machine ${machine.id}, shape ${shape.index}`;
        number(shape.index, `${at}.index`, 0, true);
        if (indices.has(shape.index)) fail(at, 'duplicate shape index');
        indices.add(shape.index);
        array(shape.cells, `${at}.cells`);
        for (const cell of shape.cells) {
          if (!Array.isArray(cell.position) || cell.position.length !== 3 || cell.position.some(value => !Number.isSafeInteger(value))) fail(at, 'cell position must contain three whole coordinates');
          array(cell.allowed_hatches, `${at}.allowed_hatches`);
          for (const hatch of cell.allowed_hatches) text(hatch, `${at}.hatch`);
          number(cell.member_rule, `${at}.member_rule`, 0, true);
          if (!dataset.shape_member_rules?.[cell.member_rule]) fail(at, 'unknown shape member rule');
        }
      }
    }
  }
  if (dataset.shape_member_rules !== undefined) {
    array(dataset.shape_member_rules, 'shape_member_rules');
    for (const [index, rule] of dataset.shape_member_rules.entries()) {
      const at = `shape_member_rules[${index}]`;
      object(rule, at);
      if (typeof rule.state_only_verified !== 'boolean') fail(at, 'state_only_verified must be a boolean');
      if (!rule.state_only_verified) continue;
      array(rule.matching_states, `${at}.matching_states`);
      for (const state of rule.matching_states) {
        object(state, at); text(state.Name, `${at}.Name`);
        object(state.Properties ?? {}, `${at}.Properties`);
        for (const value of Object.values(state.Properties ?? {})) text(value, `${at}.property`);
      }
    }
  }
  for (const upgrade of dataset.upgrades ?? []) number(upgrade.extra_max_eu, `upgrade ${upgrade.id}.extra_max_eu`, 0, true);
  if (dataset.default_machines !== undefined) references(dataset.default_machines, machines, 'default_machines');
  return {resources, machines, upgrades};
}
