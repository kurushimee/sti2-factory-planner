import {machineCapacity} from './capacity.js';

export function compileConfiguration(recipe, machine, setup = {}) {
  if (!machine.id || !recipe.id) throw new Error('A machine configuration needs machine and recipe identities.');
  const recipeType = machine.mechanic === 'mi_array' ? machine.contained_recipe_types?.[setup.contained_machine] : machine.recipe_type;
  if (recipe.type && recipeType && recipe.type !== recipeType) throw new Error('The selected machine cannot run this recipe type.');
  const shape = setup.shape ?? 0;
  if (!Number.isSafeInteger(shape) || shape < 0) throw new Error('A machine shape must be a nonnegative whole number.');
  if (machine.recipe_eu_limits && (!machine.recipe_eu_limits[shape] || recipe.eu_per_tick > machine.recipe_eu_limits[shape])) throw new Error('The selected coil tier cannot run this recipe.');
  if (machine.fluid_output_limits && (!machine.fluid_output_limits[shape] || recipe.outputs.filter(flow => flow.resource?.startsWith('fluid:')).length > machine.fluid_output_limits[shape])) throw new Error('The selected tower height would discard recipe outputs. Select enough output levels.');
  if (setup.steel_hatches) {
    if (!machine.steel_hatch_variant) throw new Error('This machine has no steel-hatch tier.');
    machine = {...machine, ...machine.steel_hatch_variant};
  }
  const capacity = machineCapacity(recipe, machine, setup);
  const energyResource = machine.energy_resource ?? 'energy:eu';
  const bill = [{resource: `item:${machine.id}`, amount: 1}];
  if (setup.upgrade_count) bill.push({resource: `item:${setup.upgrade.id}`, amount: setup.upgrade_count});
  if (setup.contained_machine) {
    if (!Number.isSafeInteger(setup.contained_count) || setup.contained_count < 1) throw new Error('An array needs a positive whole count of contained machines.');
    bill.push({resource: `item:${setup.contained_machine}`, amount: setup.contained_count});
  }
  if (setup.casing) bill.push({resource: `item:${setup.casing}`, amount: 1});
  const id = `${recipe.id}|${machine.id}|${setup.upgrade?.id ?? 'none'}:${setup.upgrade_count ?? 0}|batch:${setup.batch ?? setup.contained_count ?? 1}|${setup.contained_machine ?? ''}:${setup.contained_count ?? 0}|shape:${shape}|steel:${Boolean(setup.steel_hatches)}|${setup.casing ?? ''}`;
  return {id, machine: machine.id, operations_per_second: capacity.operations_per_second,
    eu_per_operation: energyResource === 'energy:eu' ? capacity.eu_per_operation : 0,
    inputs: energyResource === 'energy:eu' ? [] : [{resource: energyResource, amount: capacity.eu_per_operation}],
    build_cost: (machine.build_cost ?? 1) + (setup.upgrade_count ?? 0) * (setup.upgrade?.build_cost ?? 1) + (setup.contained_count ?? 0), build_requirements: bill, setup, capacity,
    capacity_input: {recipe: {duration_ticks: recipe.duration_ticks, eu_per_tick: recipe.eu_per_tick}, machine, setup},
    assumptions: capacity.assumptions};
}
