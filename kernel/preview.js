import {compileConfiguration} from './configuration.js';
import {configureRecipe} from './catalog.js';

export function previewConfiguration(dataset, request, selection) {
  const recipe = dataset.recipes.find(value => value.id === selection.recipe);
  if (!recipe) throw new Error('The selected recipe is absent from this dataset.');
  let configuration;
  if (recipe.process) {
    const machine = dataset.machines.find(value => value.id === selection.machine);
    if (!machine || machine.status !== 'supported') throw new Error('This machine has no supported capacity model.');
    if (machine.recipe_type !== recipe.process.type && machine.contained_recipe_types?.[selection.setup?.contained_machine] !== recipe.process.type) throw new Error('This machine cannot run the selected recipe.');
    configuration = compileConfiguration({...recipe, ...recipe.process}, machine, selection.setup ?? {});
    const configured = configureRecipe(recipe, dataset, {...request,
      machine_setups: {[recipe.id]: [{machine: machine.id, setup: selection.setup ?? {}}]},
      configurations: {[recipe.id]: configuration.id}}, true);
    if (configured.unsupported) throw new Error(configured.unsupported);
    configuration = configured.configurations.find(value => value.id === configuration.id);
  } else {
    const configured = configureRecipe(recipe, dataset, request);
    if (configured.unsupported) throw new Error(configured.unsupported);
    configuration = configured.configurations.find(value => value.id === selection.configuration);
  }
  if (!configuration) throw new Error('This configuration is not available with the current unlocks.');
  return {recipe: recipe.id, revision: selection.revision ?? 0, configuration, outputs: recipe.outputs.map(flow => ({resource: flow.resource,
    rate_per_machine: flow.amount * configuration.operations_per_second}))};
}
