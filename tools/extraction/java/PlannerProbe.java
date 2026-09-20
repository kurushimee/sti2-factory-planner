package planner;

import aztech.modern_industrialization.machines.MachineBlockEntity;
import aztech.modern_industrialization.machines.components.CrafterComponent;
import aztech.modern_industrialization.machines.components.FluidItemConsumerComponent;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.lang.reflect.Method;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.block.EntityBlock;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.swedz.tesseract.neoforge.compat.mi.component.craft.multiplied.MultipliedCrafterComponent;

@Mod("planner_probe")
public final class PlannerProbe {
    public PlannerProbe() {
        NeoForge.EVENT_BUS.addListener(this::registerCommands);
    }

    private void registerCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("planner_fixture_ae2")
                .requires(source -> source.hasPermission(4))
                .executes(context -> createAe2Fixture(context.getSource().getServer())));
        event.getDispatcher().register(Commands.literal("planner_probe")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try {
                        return export(context.getSource().getServer());
                    } catch (Exception error) {
                        error.printStackTrace();
                        return 0;
                    }
                }));
    }

    private static int createAe2Fixture(MinecraftServer server) {
        var level = server.overworld();
        var providerPos = new BlockPos(-1, 100, 0);
        var cablePos = new BlockPos(1, 100, 0);
        level.setBlockAndUpdate(providerPos, appeng.core.definitions.AEBlocks.PATTERN_PROVIDER.block()
                .defaultBlockState().setValue(appeng.block.crafting.PatternProviderBlock.PUSH_DIRECTION,
                        appeng.block.crafting.PushDirection.EAST));
        level.setBlockAndUpdate(cablePos, appeng.core.definitions.AEBlocks.CABLE_BUS.block().defaultBlockState());
        var pattern = appeng.core.definitions.AEItems.PROCESSING_PATTERN.stack();
        var input = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("spectrum:copper_cluster"));
        var output = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:copper_dust"));
        pattern.set(appeng.api.ids.AEComponents.ENCODED_PROCESSING_PATTERN,
                new appeng.crafting.pattern.EncodedProcessingPattern(
                        java.util.List.of(new appeng.api.stacks.GenericStack(appeng.api.stacks.AEItemKey.of(input), 1)),
                        java.util.List.of(new appeng.api.stacks.GenericStack(appeng.api.stacks.AEItemKey.of(output), 6))));
        var provider = (appeng.blockentity.crafting.PatternProviderBlockEntity) level.getBlockEntity(providerPos);
        provider.getLogic().getPatternInv().setItemDirect(0, pattern.copy());
        provider.setChanged();
        var cable = (appeng.blockentity.networking.CableBusBlockEntity) level.getBlockEntity(cablePos);
        var part = cable.addPart(appeng.core.definitions.AEParts.PATTERN_PROVIDER.get(), net.minecraft.core.Direction.WEST, null);
        part.getLogic().getPatternInv().setItemDirect(0, pattern.copy());
        cable.setChanged();
        var requesterPos = new BlockPos(10, 100, 0);
        level.setBlockAndUpdate(requesterPos, com.almostreliable.merequester.core.Registration.REQUESTER_BLOCK.get().defaultBlockState());
        var requester = (com.almostreliable.merequester.requester.RequesterBlockEntity) level.getBlockEntity(requesterPos);
        requester.getRequestManager().get(0).fromComponent(new com.almostreliable.merequester.requester.Request.Component(
                true, java.util.Optional.of(appeng.api.stacks.AEItemKey.of(output)), 4096, 64,
                com.almostreliable.merequester.requester.status.RequestStatus.IDLE));
        requester.setChanged();
        var hatch = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:steel_item_input_hatch"));
        level.setBlockAndUpdate(new BlockPos(8, 100, 0), hatch.defaultBlockState());
        System.out.println("Planner AE2 fixture created.");
        return 1;
    }

    private static void optionalNumber(JsonObject record, Object target, String method, String key) {
        try {
            Object value = target.getClass().getMethod(method).invoke(target);
            if (value instanceof Number number) record.addProperty(key, number);
        } catch (NoSuchMethodException ignored) {
            // Different machine families expose different capacity interfaces.
        } catch (Exception error) {
            record.addProperty(key + "_error", error.toString());
        }
    }

    private static JsonObject scalarFields(Object target) throws Exception {
        var result = new JsonObject();
        for (Class<?> type = target.getClass(); type != null && !type.getName().startsWith("net.minecraft."); type = type.getSuperclass()) {
            for (var field : type.getDeclaredFields()) {
                if (field.isSynthetic()) continue;
                if (!(field.getType().isPrimitive() || field.getType().isEnum() || field.getType() == String.class)) continue;
                field.setAccessible(true);
                Object value = field.get(target);
                String key = type.getSimpleName() + "." + field.getName();
                if (value instanceof Number number) result.addProperty(key, number);
                else if (value instanceof Boolean bool) result.addProperty(key, bool);
                else if (value != null) result.addProperty(key, value.toString());
            }
        }
        return result;
    }

    private static JsonObject fuelRules(FluidItemConsumerComponent consumer) throws Exception {
        var result = new JsonObject();
        result.addProperty("max_eu_per_tick", consumer.maxEuProduction);
        var multiplierField = FluidItemConsumerComponent.class.getDeclaredField("euMultiplier");
        multiplierField.setAccessible(true);
        double multiplier = multiplierField.getDouble(consumer);
        result.addProperty("multiplier", multiplier);
        var fuels = new JsonArray();
        for (var fluid : BuiltInRegistries.FLUID) {
            if (!consumer.fluidEUProductionMap.accept(fluid)) continue;
            var entry = new JsonObject();
            entry.addProperty("resource", "fluid:" + BuiltInRegistries.FLUID.getKey(fluid));
            entry.addProperty("eu_per_unit", (long) (consumer.fluidEUProductionMap.getEuProduction(fluid) * multiplier));
            fuels.add(entry);
        }
        for (var item : BuiltInRegistries.ITEM) {
            if (!consumer.itemEUProductionMap.accept(item)) continue;
            var entry = new JsonObject();
            entry.addProperty("resource", "item:" + BuiltInRegistries.ITEM.getKey(item));
            entry.addProperty("eu_per_unit", (long) (consumer.itemEUProductionMap.getEuProduction(item) * multiplier));
            fuels.add(entry);
        }
        result.add("fuels", fuels);
        return result;
    }

    private static JsonObject itemRules(MinecraftServer server) throws Exception {
        var result = new JsonObject();
        var items = new JsonArray();
        var failures = new JsonArray();
        var ops = server.registryAccess().createSerializationContext(com.mojang.serialization.JsonOps.INSTANCE);
        var replicate = aztech.modern_industrialization.machines.blockentities.ReplicatorMachineBlockEntity.class
                .getDeclaredMethod("canReplicate", net.minecraft.world.item.ItemStack.class);
        replicate.setAccessible(true);
        for (var item : BuiltInRegistries.ITEM) {
            if (item == net.minecraft.world.item.Items.AIR) continue;
            var record = new JsonObject();
            record.addProperty("id", BuiltInRegistries.ITEM.getKey(item).toString());
            try {
                var stack = new net.minecraft.world.item.ItemStack(item);
                record.addProperty("name", stack.getHoverName().getString());
                record.addProperty("max_stack_size", stack.getMaxStackSize());
                record.addProperty("burn_ticks", stack.getBurnTime(null));
                record.addProperty("replicable", (Boolean) replicate.invoke(null, stack));
                var remainder = stack.getCraftingRemainingItem();
                if (!remainder.isEmpty()) record.add("crafting_remainder",
                        net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, remainder).getOrThrow());
                items.add(record);
            } catch (Exception error) {
                record.addProperty("error", error.toString());
                failures.add(record);
            }
        }
        result.add("items", items);
        result.add("failures", failures);
        return result;
    }

    private static JsonObject ingredientRules(MinecraftServer server) throws Exception {
        var ops = server.registryAccess().createSerializationContext(com.mojang.serialization.JsonOps.INSTANCE);
        var runtime = com.google.gson.JsonParser.parseString(Files.readString(Path.of("planner-extraction/runtime.json"))).getAsJsonObject();
        var pending = new java.util.LinkedHashMap<String, com.google.gson.JsonElement>();
        for (var entry : runtime.getAsJsonArray("recipes")) {
            var raw = entry.getAsJsonObject().getAsJsonObject("recipe");
            for (String key : new String[]{"item_inputs", "ingredients"}) {
                if (key.equals("ingredients") && !raw.get("type").getAsString().matches("^(minecraft:crafting|kubejs:).*(shaped|shapeless)$")) continue;
                if (raw.has(key) && raw.get(key).isJsonArray()) {
                    for (var value : raw.getAsJsonArray(key)) pending.putIfAbsent(value.toString(), value);
                }
            }
            if (raw.has("key") && raw.get("key").isJsonObject()) {
                for (var value : raw.getAsJsonObject("key").asMap().values()) pending.putIfAbsent(value.toString(), value);
            }
        }
        var resolved = new JsonArray();
        var failures = new JsonArray();
        for (var raw : pending.values()) {
            // Ordinary item and tag ingredients are already resolved in the registry capture.
            if (!raw.toString().contains("\"type\"") && !raw.toString().contains("\"components\"")) continue;
            var record = new JsonObject();
            record.add("ingredient", raw);
            try {
                var ingredient = net.minecraft.world.item.crafting.Ingredient.CODEC.parse(ops, raw).getOrThrow();
                var stacks = new JsonArray();
                for (var stack : ingredient.getItems()) {
                    if (!ingredient.test(stack)) throw new IllegalStateException("The displayed ingredient stack does not satisfy its predicate.");
                    stacks.add(net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow());
                }
                record.add("matching_display_stacks", stacks);
                record.addProperty("is_simple", ingredient.isSimple());
                resolved.add(record);
            } catch (Exception error) {
                record.addProperty("error", error.toString());
                failures.add(record);
            }
        }
        var result = new JsonObject();
        result.add("resolved", resolved);
        result.add("failures", failures);
        return result;
    }

    private static JsonObject craftingRules(MinecraftServer server) throws Exception {
        var ops = server.registryAccess().createSerializationContext(com.mojang.serialization.JsonOps.INSTANCE);
        var records = new JsonArray();
        var failures = new JsonArray();
        for (var holder : server.getRecipeManager().getAllRecipesFor(net.minecraft.world.item.crafting.RecipeType.CRAFTING)) {
            var recipe = holder.value();
            if (!(recipe instanceof net.minecraft.world.item.crafting.ShapedRecipe)
                    && !(recipe instanceof net.minecraft.world.item.crafting.ShapelessRecipe)) continue;
            var record = new JsonObject();
            record.addProperty("id", holder.id().toString());
            record.addProperty("class", recipe.getClass().getName());
            try {
                var ingredients = recipe.getIngredients();
                int width = recipe instanceof net.minecraft.world.item.crafting.ShapedRecipe shaped ? shaped.getWidth() : 3;
                int height = recipe instanceof net.minecraft.world.item.crafting.ShapedRecipe shaped ? shaped.getHeight() : 3;
                var base = new java.util.ArrayList<net.minecraft.world.item.ItemStack>();
                boolean emptyIngredient = false;
                for (var ingredient : ingredients) {
                    var options = ingredient.getItems();
                    if (!ingredient.isEmpty() && options.length == 0) emptyIngredient = true;
                    base.add(options.length == 0 ? net.minecraft.world.item.ItemStack.EMPTY : options[0].copyWithCount(1));
                }
                while (base.size() < width * height) base.add(net.minecraft.world.item.ItemStack.EMPTY);
                if (emptyIngredient) {
                    record.addProperty("unavailable", "An ingredient has no displayed matching stacks.");
                    records.add(record);
                    continue;
                }
                var input = net.minecraft.world.item.crafting.CraftingInput.of(width, height, base);
                if (!recipe.matches(input, server.overworld())) {
                    record.addProperty("unavailable", "The displayed base ingredients do not match this recipe's extra requirements.");
                    records.add(record);
                    continue;
                }
                var output = recipe.assemble(input, server.registryAccess());
                if (output.isEmpty()) {
                    record.addProperty("unavailable", "This input combination produces an empty result.");
                    records.add(record);
                    continue;
                }
                record.add("output", net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, output).getOrThrow());
                var remaining = recipe.getRemainingItems(input);
                var samples = new JsonArray();
                for (int slot = 0; slot < base.size(); slot++) {
                    if (base.get(slot).isEmpty()) continue;
                    var sample = new JsonObject();
                    sample.addProperty("slot", slot);
                    sample.add("input", net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, base.get(slot)).getOrThrow());
                    if (!remaining.get(slot).isEmpty()) sample.add("remainder", net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, remaining.get(slot)).getOrThrow());
                    samples.add(sample);
                }
                record.add("base_slots", samples);
                var declarations = new JsonArray();
                for (var method : recipe.getClass().getMethods()) {
                    if (method.getName().equals("getRemainingItems") && !method.isBridge()) declarations.add(method.getDeclaringClass().getName());
                }
                record.add("remainder_implementations", declarations);
                records.add(record);
            } catch (Exception error) {
                record.addProperty("error", error.toString());
                failures.add(record);
            }
        }
        var result = new JsonObject();
        result.add("recipes", records);
        result.add("failures", failures);
        result.addProperty("scope", "One matching displayed input combination per shaped or shapeless recipe. Alternative combinations need separate rules or checks.");
        return result;
    }

    private static JsonArray shapes(Object target, MinecraftServer server) throws Exception {
        var result = new JsonArray();
        var seen = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<aztech.modern_industrialization.machines.multiblocks.ShapeTemplate, Boolean>());
        for (Class<?> type = target.getClass(); type != null && !type.getName().startsWith("net.minecraft."); type = type.getSuperclass()) {
            for (var field : type.getDeclaredFields()) {
                if (field.getType() != aztech.modern_industrialization.machines.multiblocks.ShapeTemplate[].class) continue;
                field.setAccessible(true);
                var templates = (aztech.modern_industrialization.machines.multiblocks.ShapeTemplate[]) field.get(target);
                if (templates == null) continue;
                for (int index = 0; index < templates.length; index++) {
                    var template = templates[index];
                    if (!seen.add(template)) continue;
                    var shape = new JsonObject();
                    shape.addProperty("field", field.getName());
                    shape.addProperty("index", index);
                    var cells = new JsonArray();
                    for (var entry : template.simpleMembers.entrySet()) {
                        var cell = new JsonObject();
                        var position = new JsonArray();
                        position.add(entry.getKey().getX()); position.add(entry.getKey().getY()); position.add(entry.getKey().getZ());
                        cell.add("position", position);
                        cell.addProperty("preview_block", BuiltInRegistries.BLOCK.getKey(entry.getValue().getPreviewState().getBlock()).toString());
                        var options = new JsonArray();
                        for (var stack : entry.getValue().getItemPreviewState(server.registryAccess()).getItems()) options.add(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                        cell.add("preview_items", options);
                        var allowed = new JsonArray();
                        var flags = template.hatchFlags.get(entry.getKey());
                        if (flags != null) for (var hatch : flags.values()) allowed.add(hatch.id().toString());
                        cell.add("allowed_hatches", allowed);
                        cells.add(cell);
                    }
                    shape.add("cells", cells);
                    result.add(shape);
                }
            }
        }
        return result;
    }

    private static JsonObject boilerWarmup(MachineBlockEntity machine, MinecraftServer server) {
        aztech.modern_industrialization.machines.components.SteamHeaterComponent heater = null;
        aztech.modern_industrialization.machines.components.FuelBurningComponent burner = null;
        for (var component : machine.components) {
            if (component instanceof aztech.modern_industrialization.machines.components.SteamHeaterComponent value) heater = value;
            if (component instanceof aztech.modern_industrialization.machines.components.FuelBurningComponent value) burner = value;
        }
        if (heater == null || burner == null) throw new IllegalStateException("The reference boiler has no heater or burner.");
        var water = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardInputSlot(1000000);
        var steam = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardOutputSlot(1000000);
        var coal = aztech.modern_industrialization.inventory.ConfigurableItemStack.standardInputSlot();
        long produced = 0, waterUsed = 0, coalUsed = 0, deficit = 0;
        var segments = new JsonArray();
        JsonObject segment = null;
        long previous = -1;
        int ticks = 0;
        while (ticks < 100000) {
            water.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(net.minecraft.world.level.material.Fluids.WATER));
            water.setAmount(1000000);
            coal.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(net.minecraft.world.item.Items.COAL));
            coal.setAmount(64);
            steam.empty();
            heater.tick(java.util.List.of(water), java.util.List.of(steam));
            burner.tick(java.util.List.of(coal), java.util.List.of(), true);
            ticks++;
            long amount = steam.getAmount();
            produced += amount;
            waterUsed += 1000000 - water.getAmount();
            coalUsed += 64 - coal.getAmount();
            deficit = Math.max(deficit, heater.maxEuProduction * ticks - produced);
            if (previous != amount) {
                segment = new JsonObject();
                segment.addProperty("first_tick", ticks);
                segment.addProperty("steam_per_tick", amount);
                segments.add(segment);
                previous = amount;
            }
            segment.addProperty("last_tick", ticks);
            if (amount == heater.maxEuProduction) break;
        }
        if (ticks == 100000) throw new IllegalStateException("The reference boiler did not reach full output.");
        var result = new JsonObject();
        result.addProperty("first_full_output_tick", ticks);
        result.addProperty("steam_produced", produced);
        result.addProperty("water_consumed", waterUsed);
        result.addProperty("coal_consumed", coalUsed);
        result.addProperty("steam_deficit", deficit);
        result.add("output_segments", segments);
        return result;
    }

    private static int export(MinecraftServer server) throws Exception {
        var machines = new JsonArray();
        var failures = new JsonArray();
        var arithmetic = new JsonArray();
        Method maxEu = CrafterComponent.class.getDeclaredMethod("getRecipeMaxEu", long.class, long.class, int.class);
        maxEu.setAccessible(true);
        for (var block : BuiltInRegistries.BLOCK) {
            String id = BuiltInRegistries.BLOCK.getKey(block).toString();
            if (!(block instanceof EntityBlock entityBlock)) continue;
            if (!id.matches("^(modern_industrialization|extended_industrialization|industrialization_overdrive|yet_another_industrialization|mi_tweaks|stcm):.*")) continue;
            try {
                var entity = entityBlock.newBlockEntity(BlockPos.ZERO, block.defaultBlockState());
                if (!(entity instanceof MachineBlockEntity machine)) continue;
                entity.setLevel(server.overworld());
                var record = new JsonObject();
                record.addProperty("id", id);
                record.addProperty("class", entity.getClass().getName());
                if (entity instanceof aztech.modern_industrialization.machines.multiblocks.HatchBlockEntity hatch) {
                    record.addProperty("role", "multiblock_part");
                    record.addProperty("hatch_type", hatch.getHatchType().id().toString());
                    record.addProperty("upgrades_steam_to_steel", hatch.upgradesToSteel());
                }
                var shapeRecords = shapes(entity, server);
                record.add("shapes", shapeRecords);
                record.add("scalar_fields", scalarFields(entity));
                record.addProperty("processing_array_eligible", net.swedz.extended_industrialization.machines.guicomponent.processingarraymachineslot.ProcessingArrayMachineSlot.isMachine(block.asItem()));
                record.addProperty("multi_processing_array_eligible", dev.wp.industrialization_overdrive.machines.guicomponents.multiprocessingarraymachineslot.MultiProcessingArrayMachineSlot.isMachine(block.asItem()));
                var components = new JsonArray();
                var componentFields = new JsonObject();
                for (Object component : machine.components) {
                    if (component instanceof aztech.modern_industrialization.machines.components.ActiveShapeComponent) {
                        shapeRecords = shapes(component, server);
                        record.add("shapes", shapeRecords);
                    }
                    components.add(component.getClass().getName());
                    componentFields.add(component.getClass().getName(), scalarFields(component));
                    if (component instanceof FluidItemConsumerComponent consumer) record.add("fuel_rules", fuelRules(consumer));
                    if (component instanceof CrafterComponent crafter) {
                        var behavior = crafter.getBehavior();
                        record.addProperty("base_eu", behavior.getBaseRecipeEu());
                        record.addProperty("max_eu", behavior.getMaxRecipeEu());
                        if (behavior.recipeType() != null) record.addProperty("recipe_type", behavior.recipeType().getId().toString());
                        if (id.equals("modern_industrialization:electric_macerator")) {
                            for (int efficiency : new int[]{0, 1, 10, 100, 600}) {
                                var sample = new JsonObject();
                                sample.addProperty("machine", id);
                                sample.addProperty("recipe_eu", 2);
                                sample.addProperty("total_eu", 400);
                                sample.addProperty("efficiency", efficiency);
                                sample.addProperty("max_eu", (Long) maxEu.invoke(crafter, 2L, 400L, efficiency));
                                arithmetic.add(sample);
                            }
                        }
                    }
                    if (component instanceof MultipliedCrafterComponent crafter) {
                        record.addProperty("batch_limit", crafter.getMaxMultiplier());
                        if (crafter.getRecipeType() != null) record.addProperty("recipe_type", crafter.getRecipeType().getId().toString());
                        optionalNumber(record, entity, "getBaseRecipeEu", "base_eu");
                        optionalNumber(record, entity, "getBaseMaxRecipeEu", "max_eu");
                        var tag = new net.minecraft.nbt.CompoundTag();
                        crafter.writeNbt(tag, server.registryAccess());
                        tag.putInt("recipeMultiplier", Math.max(1, crafter.getMaxMultiplier()));
                        crafter.readNbt(tag, server.registryAccess(), false);
                        record.addProperty("batch_energy_probe_input", 1000000);
                        record.addProperty("batch_energy_probe_output", crafter.transformEuCost(1000000, 0));
                    }
                }
                record.add("components", components);
                record.add("component_fields", componentFields);
                if (id.equals("extended_industrialization:processing_array") || id.equals("industrialization_overdrive:multi_processing_array")) {
                    var capacityMethod = entity.getClass().getDeclaredMethod("getMachineStackSize", int.class);
                    capacityMethod.setAccessible(true);
                    var capacities = new JsonArray();
                    for (int index = 0; index < shapeRecords.size(); index++) capacities.add((Integer) capacityMethod.invoke(entity, index));
                    record.add("array_shape_capacities", capacities);
                    record.addProperty("array_allows_upgrades", id.equals("extended_industrialization:processing_array")
                            ? net.swedz.extended_industrialization.EI.config().allowUpgradesInProcessingArray()
                            : dev.wp.industrialization_overdrive.IO.config().allowUpgradesInMultiProcessingArray());
                }
                if (entity instanceof aztech.modern_industrialization.machines.blockentities.multiblocks.ElectricBlastFurnaceBlockEntity) {
                    var tiers = new JsonArray();
                    for (var tier : aztech.modern_industrialization.machines.blockentities.multiblocks.ElectricBlastFurnaceBlockEntity.tiers) {
                        var value = new JsonObject();
                        value.addProperty("coil", tier.coilBlockId().toString());
                        value.addProperty("recipe_eu_limit", tier.maxBaseEu());
                        tiers.add(value);
                    }
                    record.add("coil_tiers", tiers);
                }
                record.addProperty("nbt", entity.saveWithFullMetadata(server.registryAccess()).toString());
                if (id.equals("modern_industrialization:bronze_boiler") || id.equals("modern_industrialization:steel_boiler")) {
                    record.add("coal_warmup_probe", boilerWarmup(machine, server));
                }
                machines.add(record);
            } catch (Exception error) {
                var failure = new JsonObject();
                failure.addProperty("id", id);
                failure.addProperty("error", error.toString());
                failures.add(failure);
            }
        }
        var result = new JsonObject();
        var mods = new JsonArray();
        for (var mod : net.neoforged.fml.ModList.get().getMods()) {
            var entry = new JsonObject();
            entry.addProperty("id", mod.getModId());
            entry.addProperty("version", mod.getVersion().toString());
            mods.add(entry);
        }
        result.add("loaded_mods", mods);
        result.add("machines", machines);
        result.add("failures", failures);
        result.add("arithmetic", arithmetic);
        result.add("item_rules", itemRules(server));
        result.add("ingredient_rules", ingredientRules(server));
        result.add("crafting_rules", craftingRules(server));
        var power = new JsonObject();
        power.addProperty("fe_per_eu", aztech.modern_industrialization.config.MIServerConfig.INSTANCE.forgeEnergyPerEu.getAsInt());
        power.addProperty("fe_per_ae", appeng.api.config.PowerUnit.AE.convertTo(appeng.api.config.PowerUnit.FE, 1));
        power.addProperty("ae_usage_multiplier", appeng.api.config.PowerMultiplier.CONFIG.multiplier);
        result.add("power_units", power);
        Files.createDirectories(Path.of("planner-extraction"));
        Files.writeString(Path.of("planner-extraction/machines.json"), new GsonBuilder().setPrettyPrinting().create().toJson(result));
        System.out.println("PLANNER_PROBE_COMPLETE machines=" + machines.size() + " failures=" + failures.size());
        return failures.isEmpty() ? 1 : 0;
    }
}
