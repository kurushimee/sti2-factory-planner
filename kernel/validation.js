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
  records(dataset.recipes, 'recipes');
  const machines = records(dataset.machines ?? [], 'machines');
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
    if (recipe.conditions !== undefined) {
      array(recipe.conditions, `${at}.conditions`);
      for (const condition of recipe.conditions) { object(condition, `${at}.condition`); text(condition.type, `${at}.condition.type`); }
    }
  }
  for (const machine of dataset.machines ?? []) {
    if (!['supported', 'unsupported', 'structural'].includes(machine.status)) fail(`machine ${machine.id}`, 'unknown support status');
    if (machine.status === 'supported') text(machine.mechanic, `machine ${machine.id}.mechanic`);
    if (machine.upgrades !== undefined) references(machine.upgrades, upgrades, `machine ${machine.id}.upgrades`);
  }
  for (const upgrade of dataset.upgrades ?? []) number(upgrade.extra_max_eu, `upgrade ${upgrade.id}.extra_max_eu`, 0, true);
  if (dataset.default_machines !== undefined) references(dataset.default_machines, machines, 'default_machines');
  return {resources, machines, upgrades};
}
