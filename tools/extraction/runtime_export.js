// Install only in an isolated extraction server's kubejs/server_scripts folder.
function exportPlannerData(server) {
    var Recipe = Java.loadClass('net.minecraft.world.item.crafting.Recipe');
    var JsonOps = Java.loadClass('com.mojang.serialization.JsonOps');
    var Registries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries');
    var ops = server.registryAccess().createSerializationContext(JsonOps.INSTANCE);
    var recipes = [];
    var failures = [];
    var seen = {};
    function addRecipe(holder, origin) {
        var recipeType = String(Registries.RECIPE_TYPE.getKey(holder.value().getType()));
        var key = recipeType + '|' + String(holder.id());
        if (seen[key]) return;
        seen[key] = true;
        try {
            var encoded = Recipe.CODEC.encodeStart(ops, holder.value()).getOrThrow();
            recipes.push({id: String(holder.id()), origin: origin, recipe: JSON.parse(String(encoded))});
        } catch (error) {
            if (recipeType == 'tacz:gun_smith_table_crafting') {
                try {
                    var Ingredient = Java.loadClass('com.tacz.guns.crafting.GunSmithTableIngredient');
                    var ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack');
                    var inputs = [];
                    holder.value().getInputs().forEach(input => {
                        inputs.push(JSON.parse(String(Ingredient.CODEC.encodeStart(ops, input).getOrThrow())));
                    });
                    var output = ItemStack.CODEC.encodeStart(ops, holder.value().getOutput()).getOrThrow();
                    recipes.push({id: String(holder.id()), origin: origin, adapter: 'tacz_resolved', recipe: {
                        type: recipeType, inputs: inputs, output: JSON.parse(String(output)), tab: String(holder.value().getTab())
                    }});
                } catch (fallbackError) {
                    failures.push({id: String(holder.id()), type: recipeType, error: String(fallbackError)});
                }
            } else {
                failures.push({id: String(holder.id()), type: recipeType, error: String(error)});
            }
        }
    }
    server.recipeManager.getRecipes().forEach(holder => addRecipe(holder, 'recipe_manager'));
    var MachineRecipeType = Java.loadClass('aztech.modern_industrialization.machines.recipe.MachineRecipeType');
    Registries.RECIPE_TYPE.forEach(type => {
        if (type instanceof MachineRecipeType) {
            type.getRecipesWithoutCache(server.overworld()).forEach(holder => addRecipe(holder, 'machine_recipe_provider'));
        }
    });
    var resources = [];
    var tags = {};
    function registry(reg, kind) {
        reg.forEach(value => {
            resources.push({id: String(reg.getKey(value)), kind: kind});
        });
        reg.getTags().forEach(pair => {
            var members = [];
            pair.getSecond().forEach(holder => members.push(String(reg.getKey(holder.value()))));
            tags[kind + ':' + String(pair.getFirst().location())] = members;
        });
    }
    registry(Registries.ITEM, 'item');
    registry(Registries.FLUID, 'fluid');
    var dataMaps = {};
    var MIDataMaps = Java.loadClass('aztech.modern_industrialization.api.datamaps.MIDataMaps');
    function exportDataMap(reg, type) {
        var entries = {};
        reg.forEach(value => {
            var data = value.builtInRegistryHolder().getData(type);
            if (data != null) {
                entries[String(reg.getKey(value))] = JSON.parse(String(type.codec().encodeStart(ops, data).getOrThrow()));
            }
        });
        dataMaps[String(type.id())] = entries;
    }
    exportDataMap(Registries.ITEM, MIDataMaps.MACHINE_UPGRADES);
    exportDataMap(Registries.FLUID, MIDataMaps.FLUID_FUELS);
    JsonIO.write('planner-extraction/runtime.json', {
        format: 1,
        pack: 'StaTech Industry 2.0.1',
        recipes: recipes,
        resources: resources,
        tags: tags,
        data_maps: dataMaps,
        failures: failures
    });
    console.info('PLANNER_EXPORT_COMPLETE recipes=' + recipes.length + ' failures=' + failures.length);
}
ServerEvents.basicCommand('planner_export', event => exportPlannerData(event.server));
