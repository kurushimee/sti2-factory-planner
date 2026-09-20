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
                record.add("scalar_fields", scalarFields(entity));
                record.addProperty("processing_array_eligible", net.swedz.extended_industrialization.machines.guicomponent.processingarraymachineslot.ProcessingArrayMachineSlot.isMachine(block.asItem()));
                record.addProperty("multi_processing_array_eligible", dev.wp.industrialization_overdrive.machines.guicomponents.multiprocessingarraymachineslot.MultiProcessingArrayMachineSlot.isMachine(block.asItem()));
                var components = new JsonArray();
                var componentFields = new JsonObject();
                for (Object component : machine.components) {
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
                record.addProperty("nbt", entity.saveWithFullMetadata(server.registryAccess()).toString());
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
        Files.createDirectories(Path.of("planner-extraction"));
        Files.writeString(Path.of("planner-extraction/machines.json"), new GsonBuilder().setPrettyPrinting().create().toJson(result));
        System.out.println("PLANNER_PROBE_COMPLETE machines=" + machines.size() + " failures=" + failures.size());
        return failures.isEmpty() ? 1 : 0;
    }
}
