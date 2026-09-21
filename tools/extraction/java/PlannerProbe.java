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
        event.getDispatcher().register(Commands.literal("planner_check_structure_bill")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return checkStructureBill(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_fixture_structure")
                .requires(source -> source.hasPermission(4))
                .executes(context -> createStructureFixture(context.getSource().getServer())));
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

    private static int checkStructureBill(MinecraftServer server) throws Exception {
        var bill = com.google.gson.JsonParser.parseString(Files.readString(Path.of("planner-structure-bill.json"))).getAsJsonObject();
        var level = server.overworld();
        var coordinates = bill.getAsJsonArray("origin");
        var origin = coordinates == null ? new BlockPos(128, 100, 0) : new BlockPos(coordinates.get(0).getAsInt(), coordinates.get(1).getAsInt(), coordinates.get(2).getAsInt());
        var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(bill.get("machine").getAsString()));
        level.setBlockAndUpdate(origin, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        level.setBlockAndUpdate(origin, block.defaultBlockState());
        var controller = (aztech.modern_industrialization.machines.multiblocks.MultiblockMachineBlockEntity) level.getBlockEntity(origin);
        var facing = net.minecraft.core.Direction.NORTH;
        controller.getOrientation().facingDirection = facing;
        var shape = controller.getActiveShape();
        var counts = new java.util.TreeMap<String, Integer>();
        for (var value : bill.getAsJsonArray("placements")) {
            var entry = value.getAsJsonObject();
            var xyz = entry.getAsJsonArray("position");
            var relative = new BlockPos(xyz.get(0).getAsInt(), xyz.get(1).getAsInt(), xyz.get(2).getAsInt());
            var position = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldPos(origin, facing, relative);
            String id = entry.get("block").getAsString();
            var placed = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(id));
            var member = shape.simpleMembers.get(relative);
            if (member == null) throw new IllegalStateException("The bill contains a position outside the loaded template.");
            var state = member.getPreviewState().is(placed) ? member.getPreviewState() : placed.defaultBlockState();
            state = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldState(level, position, state, facing);
            level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            level.setBlockAndUpdate(position, state);
            if (!state.isAir()) counts.merge(id, 1, Integer::sum);
        }
        var matcher = controller.createShapeMatcher();
        matcher.rematch(level);
        if (!matcher.isMatchSuccessful()) throw new IllegalStateException("The loaded shape matcher rejected the planned structural bill.");
        var result = new JsonObject();
        result.addProperty("machine", bill.get("machine").getAsString());
        result.addProperty("shape_match", true);
        var quantities = new JsonObject();
        counts.forEach(quantities::addProperty);
        result.add("placed_blocks_excluding_controller", quantities);
        if (bill.get("machine").getAsString().equals("yet_another_industrialization:nuclear_rod_irradiator")) {
            result.add("startup_cycle", formedIrradiatorCycle(controller, matcher, server));
        }
        Files.writeString(Path.of("planner-extraction", "structure-bill-check.json"), new GsonBuilder().setPrettyPrinting().create().toJson(result));
        controller.setChanged();
        System.out.println("Planner structural bill matched the loaded world structure.");
        return 1;
    }

    private static JsonObject formedIrradiatorCycle(MachineBlockEntity machine,
            aztech.modern_industrialization.machines.multiblocks.ShapeMatcher matcher, MinecraftServer server) {
        var nuclear = new java.util.ArrayList<aztech.modern_industrialization.machines.blockentities.hatches.NuclearHatch>();
        var energy = new java.util.ArrayList<aztech.modern_industrialization.machines.components.EnergyComponent>();
        aztech.modern_industrialization.inventory.ConfigurableItemStack source = null;
        for (var hatch : matcher.getMatchedHatches()) {
            hatch.appendEnergyInputs(energy);
            if (hatch instanceof aztech.modern_industrialization.machines.blockentities.hatches.NuclearHatch value) {
                var slot = value.getInventory().getItemStacks().getFirst();
                slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(
                        BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:uranium_fuel_rod"))));
                slot.setAmount(1);
                nuclear.add(value);
            } else if (hatch.getHatchType() == aztech.modern_industrialization.machines.multiblocks.HatchTypes.ITEM_INPUT) {
                source = hatch.getInventory().getItemStacks().getFirst();
                source.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(
                        BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:beryllium_block"))));
                source.setAmount(64);
            }
        }
        if (source == null || nuclear.size() != 8 || energy.isEmpty()) throw new IllegalStateException("The irradiator fixture has incorrect hatches.");
        // Release the inspection matcher so the controller can claim its own hatches.
        matcher.unlinkHatches();
        var levelData = (net.minecraft.world.level.storage.ServerLevelData) server.overworld().getLevelData();
        long previousTime = levelData.getGameTime(), consumed = 0, produced = 0;
        int tick = 0;
        try {
            while (produced == 0 && tick < 10000) {
                levelData.setGameTime(++tick);
                for (var component : energy) component.insertEu(component.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                long before = energy.stream().mapToLong(component -> component.getEu()).sum();
                ((aztech.modern_industrialization.util.Tickable) machine).tick();
                consumed += before - energy.stream().mapToLong(component -> component.getEu()).sum();
                produced = nuclear.stream().mapToLong(hatch -> hatch.getInventory().getItemStacks().stream().skip(1).mapToLong(slot -> slot.getAmount()).sum()).sum();
            }
        } finally { levelData.setGameTime(previousTime); }
        var result = new JsonObject();
        result.addProperty("completion_tick", tick);
        result.addProperty("depleted_rods", produced);
        result.addProperty("energy_consumed", consumed);
        result.addProperty("beryllium_consumed_sample", 64 - source.getAmount());
        if (produced != 8 || tick != 8059 || consumed != 8192000) throw new IllegalStateException("The formed irradiator cycle changed: " + result);
        // Save active input rods as independent evidence for the world importer.
        for (var hatch : nuclear) {
            var slot = hatch.getInventory().getItemStacks().getFirst();
            slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(
                    BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:uranium_fuel_rod"))));
            slot.setAmount(1);
            hatch.setChanged();
        }
        result.addProperty("saved_input_rods", nuclear.size());
        return result;
    }

    private static int createStructureFixture(MinecraftServer server) {
        var level = server.overworld();
        var controllerPos = new BlockPos(64, 100, 0);
        var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:electric_blast_furnace"));
        level.setBlockAndUpdate(controllerPos, block.defaultBlockState());
        var controller = (aztech.modern_industrialization.machines.multiblocks.MultiblockMachineBlockEntity) level.getBlockEntity(controllerPos);
        var facing = net.minecraft.core.Direction.EAST;
        controller.getOrientation().facingDirection = facing;
        var shape = controller.getActiveShape();
        var occupied = new java.util.HashSet<BlockPos>();
        occupied.add(controllerPos);
        for (var entry : shape.simpleMembers.entrySet()) {
            var pos = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldPos(controllerPos, facing, entry.getKey());
            occupied.add(pos);
            var state = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldState(level, pos, entry.getValue().getPreviewState(), facing);
            level.setBlockAndUpdate(pos, state);
        }
        var hatchBlock = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:steel_item_input_hatch"));
        BlockPos hatchPos = null, providerPos = null;
        net.minecraft.core.Direction delivery = null;
        for (var entry : shape.hatchFlags.entrySet()) {
            if (entry.getValue().values().stream().noneMatch(type -> type.id().toString().equals("modern_industrialization:item_input"))) continue;
            var pos = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldPos(controllerPos, facing, entry.getKey());
            for (var direction : net.minecraft.core.Direction.Plane.HORIZONTAL) {
                var neighbor = pos.relative(direction);
                if (occupied.contains(neighbor)) continue;
                hatchPos = pos; providerPos = neighbor; delivery = direction.getOpposite(); break;
            }
            if (hatchPos != null) break;
        }
        if (hatchPos == null) throw new IllegalStateException("The fixture has no exterior input hatch position.");
        level.setBlockAndUpdate(hatchPos, hatchBlock.defaultBlockState());
        level.setBlockAndUpdate(providerPos, appeng.core.definitions.AEBlocks.PATTERN_PROVIDER.block().defaultBlockState()
                .setValue(appeng.block.crafting.PatternProviderBlock.PUSH_DIRECTION, appeng.block.crafting.PushDirection.valueOf(delivery.name())));
        var pattern = appeng.core.definitions.AEItems.PROCESSING_PATTERN.stack();
        var input = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:uncooked_steel_dust"));
        var output = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:steel_ingot"));
        pattern.set(appeng.api.ids.AEComponents.ENCODED_PROCESSING_PATTERN, new appeng.crafting.pattern.EncodedProcessingPattern(
                java.util.List.of(new appeng.api.stacks.GenericStack(appeng.api.stacks.AEItemKey.of(input), 1)),
                java.util.List.of(new appeng.api.stacks.GenericStack(appeng.api.stacks.AEItemKey.of(output), 1))));
        var provider = (appeng.blockentity.crafting.PatternProviderBlockEntity) level.getBlockEntity(providerPos);
        provider.getLogic().getPatternInv().setItemDirect(0, pattern);
        provider.setChanged(); controller.setChanged();
        var matcher = controller.createShapeMatcher();
        matcher.rematch(level);
        if (!matcher.isMatchSuccessful()) throw new IllegalStateException("The actual MI shape matcher rejected the fixture.");
        System.out.println("Planner structure fixture matched: controller=" + controllerPos + ", hatch=" + hatchPos + ", provider=" + providerPos);
        return 1;
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
        var replicatorPos = new BlockPos(12, 100, 0);
        var replicatorBlock = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:replicator"));
        level.setBlockAndUpdate(replicatorPos, replicatorBlock.defaultBlockState());
        var replicator = (aztech.modern_industrialization.machines.blockentities.ReplicatorMachineBlockEntity) level.getBlockEntity(replicatorPos);
        var template = replicator.getInventory().getItemStacks().get(0);
        template.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(net.minecraft.world.item.Items.IRON_INGOT));
        template.setAmount(1);
        replicator.setChanged();
        var assemblerPos = new BlockPos(14, 100, 0);
        level.setBlockAndUpdate(assemblerPos, appeng.core.definitions.AEBlocks.MOLECULAR_ASSEMBLER.block().defaultBlockState());
        var assembler = (appeng.blockentity.crafting.MolecularAssemblerBlockEntity) level.getBlockEntity(assemblerPos);
        var craftingPattern = appeng.core.definitions.AEItems.CRAFTING_PATTERN.stack();
        var craftingInputs = new java.util.ArrayList<net.minecraft.world.item.ItemStack>();
        for (int slot = 0; slot < 9; slot++) craftingInputs.add(slot == 0 || slot == 3
                ? new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.OAK_PLANKS) : net.minecraft.world.item.ItemStack.EMPTY);
        craftingPattern.set(appeng.api.ids.AEComponents.ENCODED_CRAFTING_PATTERN,
                new appeng.crafting.pattern.EncodedCraftingPattern(craftingInputs,
                        new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.STICK, 4),
                        net.minecraft.resources.ResourceLocation.parse("minecraft:stick"), false, false));
        assembler.getInternalInventory().setItemDirect(10, craftingPattern);
        assembler.getUpgrades().setItemDirect(0, appeng.core.definitions.AEItems.SPEED_CARD.stack());
        assembler.getUpgrades().setItemDirect(1, appeng.core.definitions.AEItems.SPEED_CARD.stack());
        assembler.setChanged();
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
        result.addProperty("standard_item_fuels", consumer.itemEUProductionMap.isStandardFuels());
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
                record.addProperty("max_damage", stack.getMaxDamage());
                record.addProperty("burn_ticks", stack.getBurnTime(null));
                record.addProperty("replicable", (Boolean) replicate.invoke(null, stack));
                var cell = stack.get(net.swedz.extended_industrialization.EIComponents.PHOTOVOLTAIC_CELL.get());
                if (cell != null) record.add("photovoltaic_cell",
                        net.swedz.extended_industrialization.component.PhotovoltaicCell.CODEC.encodeStart(ops, cell).getOrThrow());
                if (item instanceof aztech.modern_industrialization.nuclear.NuclearFuel fuel) {
                    var nuclear = new JsonObject();
                    nuclear.addProperty("disintegrations", fuel.getRemainingDesintegrations(stack));
                    nuclear.addProperty("product", BuiltInRegistries.ITEM.getKey(fuel.getNeutronProduct().getItem()).toString());
                    nuclear.addProperty("product_amount", fuel.getNeutronProductAmount());
                    nuclear.addProperty("size", fuel.size);
                    nuclear.addProperty("direct_eu_per_disintegration", fuel.directEUbyDesintegration);
                    nuclear.addProperty("total_eu_per_disintegration", fuel.totalEUbyDesintegration);
                    record.add("nuclear_fuel", nuclear);
                }
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

    private static <R, T> void captureDataMap(JsonObject result, net.minecraft.core.Registry<R> registry,
            net.neoforged.neoforge.registries.datamaps.DataMapType<R, T> type, MinecraftServer server) {
        var entries = new JsonObject();
        var ops = server.registryAccess().createSerializationContext(com.mojang.serialization.JsonOps.INSTANCE);
        for (var entry : registry.getDataMap(type).entrySet()) {
            entries.add(entry.getKey().location().toString(), type.codec().encodeStart(ops, entry.getValue()).getOrThrow());
        }
        result.add(type.id().toString(), entries);
    }

    private static JsonObject integrationDataMaps(MinecraftServer server) {
        var result = new JsonObject();
        captureDataMap(result, BuiltInRegistries.BLOCK, net.swedz.extended_industrialization.EIDataMaps.FARMER_SIMPLE_TALL_CROP_SIZE, server);
        captureDataMap(result, BuiltInRegistries.FLUID, net.swedz.extended_industrialization.EIDataMaps.FERTILIZER_POTENCY, server);
        captureDataMap(result, BuiltInRegistries.BLOCK, net.swedz.extended_industrialization.EIDataMaps.LARGE_ELECTRIC_FURNACE_TIER, server);
        captureDataMap(result, BuiltInRegistries.BLOCK, net.swedz.extended_industrialization.EIDataMaps.TESLA_TOWER_TIER, server);
        captureDataMap(result, BuiltInRegistries.ITEM, net.swedz.extended_industrialization.EIDataMaps.ENCHANTMENT_MODULE, server);
        var yai = me.luligabi.yet_another_industrialization.common.misc.datamap.YAIDataMaps.INSTANCE;
        captureDataMap(result, BuiltInRegistries.BLOCK, yai.getARBOREOUS_GREENHOUSE_TIER(), server);
        captureDataMap(result, BuiltInRegistries.BLOCK, yai.getFLIGHT_PYLON_TIER(), server);
        captureDataMap(result, BuiltInRegistries.BLOCK, yai.getLARGE_STORAGE_UNIT_TIER(), server);
        captureDataMap(result, BuiltInRegistries.ITEM, yai.getIRRADIATOR_NEUTRON_SOURCE(), server);
        captureDataMap(result, BuiltInRegistries.ITEM, yai.getNUMISMATIC_GENERATOR_CURRENCY(), server);
        return result;
    }

    private static JsonArray progressionChapters() throws Exception {
        var result = new JsonArray();
        try (var paths = Files.list(Path.of("config/ftbquests/quests/chapters"))) {
            for (var path : paths.sorted().toList()) {
                if (!path.getFileName().toString().matches("[1-8]__.*\\.snbt")) continue;
                var chapter = dev.ftb.mods.ftblibrary.snbt.SNBT.tryRead(path);
                if (chapter == null) throw new IllegalStateException("Could not read progression chapter: " + path);
                var record = new JsonObject();
                record.addProperty("file", path.toString().replace('\\', '/'));
                record.addProperty("id", chapter.getString("id"));
                record.addProperty("order", chapter.getInt("order_index"));
                var tasks = new JsonArray();
                for (var tag : chapter.getList("quests", 10)) {
                    var quest = (net.minecraft.nbt.CompoundTag) tag;
                    for (var taskTag : quest.getList("tasks", 10)) {
                        var task = (net.minecraft.nbt.CompoundTag) taskTag;
                        if (!task.getString("type").equals("item")) continue;
                        var item = task.getCompound("item");
                        if (!item.contains("id")) continue;
                        var value = new JsonObject();
                        value.addProperty("quest", quest.getString("id"));
                        value.addProperty("task", task.getString("id"));
                        value.addProperty("item", item.getString("id"));
                        tasks.add(value);
                    }
                }
                record.add("item_tasks", tasks);
                result.add(record);
            }
        }
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
        var candidates = new java.util.LinkedHashMap<String, net.minecraft.world.item.ItemStack>();
        for (var item : BuiltInRegistries.ITEM) {
            var stack = item.getDefaultInstance();
            if (!stack.isEmpty()) candidates.put(net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow().toString(), stack);
        }
        for (var raw : pending.values()) {
            var decoded = net.minecraft.world.item.crafting.Ingredient.CODEC.parse(ops, raw);
            decoded.result().ifPresent(ingredient -> {
                for (var stack : ingredient.getItems()) if (!stack.isEmpty()) {
                    candidates.put(net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow().toString(), stack);
                }
            });
        }
        collectStackVariants(runtime.getAsJsonArray("recipes"), ops, candidates);
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
                var matching = new JsonArray();
                for (var stack : candidates.values()) {
                    if (ingredient.test(stack)) matching.add(net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow());
                }
                record.add("matching_stacks", matching);
                record.addProperty("matching_scope", "captured_resource_variants");
                record.addProperty("tested_variants", candidates.size());
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
        var variantRules = new JsonArray();
        for (var stack : candidates.values()) {
            var encoded = net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow();
            if (!encoded.getAsJsonObject().has("components")) continue;
            var record = new JsonObject();
            record.add("stack", encoded);
            var remainder = stack.getCraftingRemainingItem();
            if (!remainder.isEmpty()) record.add("crafting_remainder", net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, remainder).getOrThrow());
            variantRules.add(record);
        }
        result.add("variant_item_rules", variantRules);
        result.addProperty("tested_variant_count", candidates.size());
        result.addProperty("scope", "Default item stacks, ingredient display variants, and component-bearing stacks encoded in effective recipes. Other component combinations are not claimed.");
        return result;
    }

    private static void collectStackVariants(com.google.gson.JsonElement value,
            com.mojang.serialization.DynamicOps<com.google.gson.JsonElement> ops,
            java.util.Map<String, net.minecraft.world.item.ItemStack> candidates) {
        if (value.isJsonArray()) {
            for (var child : value.getAsJsonArray()) collectStackVariants(child, ops, candidates);
        } else if (value.isJsonObject()) {
            var object = value.getAsJsonObject();
            var identity = object.has("item") ? object.get("item") : object.get("id");
            if (identity != null && identity.isJsonPrimitive() && identity.getAsJsonPrimitive().isString() && object.has("components")) {
                var id = net.minecraft.resources.ResourceLocation.tryParse(identity.getAsString());
                if (id != null && BuiltInRegistries.ITEM.containsKey(id)) {
                    var encoded = new JsonObject();
                    encoded.addProperty("id", id.toString());
                    encoded.addProperty("count", 1);
                    encoded.add("components", object.get("components"));
                    var stack = net.minecraft.world.item.ItemStack.CODEC.parse(ops, encoded).getOrThrow();
                    candidates.put(net.minecraft.world.item.ItemStack.CODEC.encodeStart(ops, stack).getOrThrow().toString(), stack);
                }
            }
            for (var child : object.asMap().values()) collectStackVariants(child, ops, candidates);
        }
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
                if (holder.id().toString().equals("modern_industrialization:iron_plate_from_hammer")) {
                    var lifetimes = new JsonArray();
                    for (int slot = 0; slot < ingredients.size(); slot++) {
                        for (var tool : ingredients.get(slot).getItems()) {
                            if (!tool.isDamageableItem()) continue;
                            var current = tool.copyWithCount(1);
                            var encodedInputs = new java.util.ArrayList<net.minecraft.world.item.ItemStack>();
                            for (var stack : base) encodedInputs.add(stack.copy());
                            encodedInputs.set(slot, current.copy());
                            var patternItem = appeng.core.definitions.AEItems.CRAFTING_PATTERN.stack();
                            patternItem.set(appeng.api.ids.AEComponents.ENCODED_CRAFTING_PATTERN,
                                    new appeng.crafting.pattern.EncodedCraftingPattern(encodedInputs, output.copy(), holder.id(), true, false));
                            var plan = (appeng.blockentity.crafting.IMolecularAssemblerSupportedPattern) appeng.api.crafting.PatternDetailsHelper.decodePattern(patternItem, server.overworld());
                            if (plan == null) throw new IllegalStateException("AE2 did not decode the tool crafting pattern.");
                            int crafts = 0;
                            while (!current.isEmpty() && crafts < 10000) {
                                if (!plan.isItemValid(slot, appeng.api.stacks.AEItemKey.of(current), server.overworld())) throw new IllegalStateException("AE2 rejected the used hammer with substitutions enabled.");
                                var trial = new java.util.ArrayList<net.minecraft.world.item.ItemStack>();
                                for (var stack : base) trial.add(stack.copy());
                                trial.set(slot, current);
                                var trialInput = net.minecraft.world.item.crafting.CraftingInput.of(width, height, trial);
                                if (!recipe.matches(trialInput, server.overworld())) throw new IllegalStateException("The used hammer stopped matching before it broke.");
                                current = recipe.getRemainingItems(trialInput).get(slot);
                                crafts++;
                            }
                            if (!current.isEmpty()) throw new IllegalStateException("The hammer lifetime probe did not reach breakage.");
                            var lifetime = new JsonObject();
                            lifetime.addProperty("item", BuiltInRegistries.ITEM.getKey(tool.getItem()).toString());
                            lifetime.addProperty("max_damage", tool.getMaxDamage());
                            lifetime.addProperty("crafts", crafts);
                            lifetime.addProperty("ae2_substitutions_verified", true);
                            lifetimes.add(lifetime);
                        }
                    }
                    record.add("tool_lifetimes", lifetimes);
                }
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

    private static final java.util.Map<aztech.modern_industrialization.machines.multiblocks.SimpleMember, Integer> memberRules = new java.util.IdentityHashMap<>();
    private static final java.util.Map<String, Integer> memberRuleIds = new java.util.LinkedHashMap<>();
    private static final JsonArray shapeMemberRules = new JsonArray();

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static String stateValue(net.minecraft.world.level.block.state.properties.Property property, Comparable value) {
        return property.getName(value);
    }

    private static int memberRule(aztech.modern_industrialization.machines.multiblocks.SimpleMember member) {
        return memberRules.computeIfAbsent(member, value -> {
            var rule = new JsonObject();
            String name = value.getClass().getName();
            rule.addProperty("source_class", name);
            // These four MI factories only inspect block state. Other predicates can require live block entities.
            boolean stateOnly = name.matches("aztech\\.modern_industrialization\\.machines\\.multiblocks\\.SimpleMember\\$[1-4]");
            rule.addProperty("state_only_verified", stateOnly);
            if (stateOnly) {
                var states = new JsonArray();
                for (var block : BuiltInRegistries.BLOCK) for (var state : block.getStateDefinition().getPossibleStates()) {
                    if (!value.matchesState(state, null)) continue;
                    var record = new JsonObject();
                    record.addProperty("Name", BuiltInRegistries.BLOCK.getKey(block).toString());
                    var properties = new JsonObject();
                    for (var property : state.getValues().entrySet()) properties.addProperty(property.getKey().getName(), stateValue(property.getKey(), property.getValue()));
                    record.add("Properties", properties);
                    states.add(record);
                }
                rule.add("matching_states", states);
            }
            return memberRuleIds.computeIfAbsent(rule.toString(), key -> {
                int index = shapeMemberRules.size(); shapeMemberRules.add(rule); return index;
            });
        });
    }

    private static JsonArray shapes(Object target, MinecraftServer server) throws Exception {
        var result = new JsonArray();
        var seen = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<aztech.modern_industrialization.machines.multiblocks.ShapeTemplate, Boolean>());
        for (Class<?> type = target.getClass(); type != null && !type.getName().startsWith("net.minecraft."); type = type.getSuperclass()) {
            for (var field : type.getDeclaredFields()) {
                boolean single = field.getType() == aztech.modern_industrialization.machines.multiblocks.ShapeTemplate.class;
                if (!single && field.getType() != aztech.modern_industrialization.machines.multiblocks.ShapeTemplate[].class) continue;
                field.setAccessible(true);
                var templates = single
                        ? new aztech.modern_industrialization.machines.multiblocks.ShapeTemplate[]{(aztech.modern_industrialization.machines.multiblocks.ShapeTemplate) field.get(target)}
                        : (aztech.modern_industrialization.machines.multiblocks.ShapeTemplate[]) field.get(target);
                if (templates == null) continue;
                for (int index = 0; index < templates.length; index++) {
                    var template = templates[index];
                    if (template == null || !seen.add(template)) continue;
                    var shape = new JsonObject();
                    shape.addProperty("field", field.getName());
                    shape.addProperty("index", index);
                    var cells = new JsonArray();
                    for (var entry : template.simpleMembers.entrySet()) {
                        var cell = new JsonObject();
                        var position = new JsonArray();
                        position.add(entry.getKey().getX()); position.add(entry.getKey().getY()); position.add(entry.getKey().getZ());
                        cell.add("position", position);
                        cell.addProperty("member_rule", memberRule(entry.getValue()));
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

    private static JsonObject boilerWarmup(MachineBlockEntity machine, MinecraftServer server, String fluidFuel, boolean heavyWater) {
        machine = (MachineBlockEntity) ((EntityBlock) machine.getBlockState().getBlock()).newBlockEntity(BlockPos.ZERO, machine.getBlockState());
        machine.setLevel(server.overworld());
        aztech.modern_industrialization.machines.components.SteamHeaterComponent heater = null;
        aztech.modern_industrialization.machines.components.FuelBurningComponent burner = null;
        for (var component : machine.components) {
            if (component instanceof aztech.modern_industrialization.machines.components.SteamHeaterComponent value) heater = value;
            if (component instanceof aztech.modern_industrialization.machines.components.FuelBurningComponent value) burner = value;
        }
        if (heater == null || burner == null) throw new IllegalStateException("The reference boiler has no heater or burner.");
        int pressure = heater.acceptHighPressure && !heater.acceptLowPressure ? 8 : 1;
        var inputFluid = pressure == 8 ? aztech.modern_industrialization.MIFluids.HIGH_PRESSURE_WATER.asFluid() : net.minecraft.world.level.material.Fluids.WATER;
        if (heavyWater) inputFluid = pressure == 8 ? aztech.modern_industrialization.MIFluids.HIGH_PRESSURE_HEAVY_WATER.asFluid() : aztech.modern_industrialization.MIFluids.HEAVY_WATER.asFluid();
        long maximum = heater.maxEuProduction / pressure;
        var water = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardInputSlot(1000000);
        var steam = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardOutputSlot(1000000);
        var coal = aztech.modern_industrialization.inventory.ConfigurableItemStack.standardInputSlot();
        var fuelInput = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardInputSlot(1000000);
        if (fluidFuel != null) fuelInput.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(
                BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse(fluidFuel))));
        long produced = 0, waterUsed = 0, coalUsed = 0, fluidUsed = 0, deficit = 0;
        var segments = new JsonArray();
        JsonObject segment = null;
        long previous = -1;
        int ticks = 0;
        while (ticks < 100000) {
            water.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(inputFluid));
            water.setAmount(1000000);
            coal.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(net.minecraft.world.item.Items.COAL));
            coal.setAmount(64);
            fuelInput.setAmount(1000000);
            steam.empty();
            heater.tick(java.util.List.of(water), java.util.List.of(steam));
            burner.tick(fluidFuel == null ? java.util.List.of(coal) : java.util.List.of(),
                    fluidFuel == null ? java.util.List.of() : java.util.List.of(fuelInput), true);
            ticks++;
            long amount = steam.getAmount();
            produced += amount;
            waterUsed += 1000000 - water.getAmount();
            coalUsed += 64 - coal.getAmount();
            fluidUsed += 1000000 - fuelInput.getAmount();
            deficit = Math.max(deficit, maximum * ticks - produced);
            if (previous != amount) {
                segment = new JsonObject();
                segment.addProperty("first_tick", ticks);
                segment.addProperty("steam_per_tick", amount);
                segments.add(segment);
                previous = amount;
            }
            segment.addProperty("last_tick", ticks);
            if (amount == maximum) break;
        }
        if (ticks == 100000) throw new IllegalStateException("The reference boiler did not reach full output.");
        var result = new JsonObject();
        result.addProperty("first_full_output_tick", ticks);
        result.addProperty("steam_produced", produced);
        result.addProperty("water_consumed", waterUsed);
        result.addProperty("coal_consumed", coalUsed);
        result.addProperty("steam_deficit", deficit);
        result.add("output_segments", segments);
        result.addProperty("eu_per_steam_mb", pressure);
        result.addProperty("water", BuiltInRegistries.FLUID.getKey(inputFluid).toString());
        if (fluidFuel != null) {
            result.addProperty("fluid_fuel", fluidFuel);
            result.addProperty("fluid_consumed", fluidUsed);
            result.addProperty("fuel_eu_per_mb", aztech.modern_industrialization.api.datamaps.FluidFuel.getEu(fuelInput.getResource().getFluid()));
            return result;
        }
        var running = new JsonArray();
        for (long output = 0; output <= maximum; output++) {
            var limitedSteam = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardOutputSlot(output);
            water.setAmount(1000000);
            heater.increaseTemperature(1000000);
            var before = new net.minecraft.nbt.CompoundTag();
            before.putLong("burningEuBuffer", 1000000000L);
            burner.readNbt(before, server.registryAccess(), false);
            heater.tick(java.util.List.of(water), java.util.List.of(limitedSteam));
            burner.tick(java.util.List.of(), java.util.List.of(), false);
            var after = new net.minecraft.nbt.CompoundTag();
            burner.writeNbt(after, server.registryAccess());
            if (limitedSteam.getAmount() != output) throw new IllegalStateException("The hot boiler did not match its constrained output.");
            var point = new JsonObject();
            point.addProperty("steam_per_tick", output);
            point.addProperty("fuel_eu_per_tick", 1000000000L - after.getLong("burningEuBuffer"));
            running.add(point);
        }
        result.add("hot_running_probe", running);
        return result;
    }

    @SuppressWarnings("unchecked")
    private static JsonArray recipeGeneration(MachineBlockEntity machine, MinecraftServer server) throws Exception {
        var generator = (aztech.modern_industrialization.api.machine.holder.EnergyListComponentHolder) machine;
        var crafter = ((aztech.modern_industrialization.machines.blockentities.multiblocks.AbstractCraftingMultiblockBlockEntity) machine).getCrafterComponent();
        var behavior = crafter.getBehavior();
        var active = CrafterComponent.class.getDeclaredField("activeRecipe");
        active.setAccessible(true);
        var energy = new aztech.modern_industrialization.machines.components.EnergyComponent(machine, 1000000000000L);
        ((java.util.List<aztech.modern_industrialization.machines.components.EnergyComponent>) generator.getEnergyComponents()).add(energy);
        var records = new JsonArray();
        for (var holder : server.getRecipeManager().getRecipes()) {
            if (!(holder.value() instanceof aztech.modern_industrialization.machines.recipe.MachineRecipe recipe)
                    || recipe.getType() != behavior.recipeType()) continue;
            var record = new JsonObject();
            record.addProperty("recipe", holder.id().toString());
            record.addProperty("duration_ticks", recipe.duration);
            record.addProperty("recipe_eu", recipe.eu);
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            record.addProperty("accepted_with_empty_hatch", recipe.conditionsMatch(() -> machine));
            active.set(crafter, holder);
            long before = energy.getEu();
            behavior.onCraft();
            record.addProperty("eu_delivered_on_completion", energy.getEu() - before);
            record.addProperty("internal_progress_eu", behavior.consumeEu(1, aztech.modern_industrialization.util.Simulation.ACT));
            energy.insertEu(energy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
            record.addProperty("accepted_with_full_hatch", recipe.conditionsMatch(() -> machine));
            record.add("cycle", generationCycle(machine, server, holder));
            records.add(record);
        }
        generator.getEnergyComponents().clear();
        active.set(crafter, null);
        return records;
    }

    @SuppressWarnings("unchecked")
    private static JsonObject generationCycle(MachineBlockEntity prototype, MinecraftServer server,
            net.minecraft.world.item.crafting.RecipeHolder<?> holder) {
        var machine = (aztech.modern_industrialization.machines.blockentities.multiblocks.AbstractCraftingMultiblockBlockEntity)
                ((EntityBlock) prototype.getBlockState().getBlock()).newBlockEntity(BlockPos.ZERO, prototype.getBlockState());
        machine.setLevel(server.overworld());
        var recipe = (aztech.modern_industrialization.machines.recipe.MachineRecipe) holder.value();
        var inventory = machine.getMultiblockInventoryComponent();
        for (var input : recipe.itemInputs) {
            var slot = aztech.modern_industrialization.inventory.ConfigurableItemStack.standardInputSlot();
            slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(input.ingredient().getItems()[0]));
            slot.setAmount(input.amount());
            inventory.getItemInputs().add(slot);
        }
        for (var input : recipe.fluidInputs) {
            var slot = aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardInputSlot(1000000000);
            slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(input.fluid().getStacks()[0].getFluid()));
            slot.setAmount(input.amount());
            inventory.getFluidInputs().add(slot);
        }
        for (var output : recipe.itemOutputs) inventory.getItemOutputs().add(aztech.modern_industrialization.inventory.ConfigurableItemStack.standardOutputSlot());
        for (var output : recipe.fluidOutputs) inventory.getFluidOutputs().add(aztech.modern_industrialization.inventory.ConfigurableFluidStack.standardOutputSlot(1000000000));
        var energy = new aztech.modern_industrialization.machines.components.EnergyComponent(machine, 1000000000000L);
        ((java.util.List<aztech.modern_industrialization.machines.components.EnergyComponent>)
                ((aztech.modern_industrialization.api.machine.holder.EnergyListComponentHolder) machine).getEnergyComponents()).add(energy);
        int ticks = 0;
        while (energy.getEu() == 0 && ticks <= recipe.duration + 1) {
            machine.getCrafterComponent().tickRecipe();
            ticks++;
        }
        if (energy.getEu() == 0) throw new IllegalStateException("The actual generator cycle did not complete: " + holder.id());
        var result = new JsonObject();
        result.addProperty("completion_tick", ticks);
        result.addProperty("generated_eu", energy.getEu());
        result.addProperty("remaining_items", inventory.getItemInputs().stream().mapToLong(slot -> slot.getAmount()).sum());
        result.addProperty("remaining_fluid_mb", inventory.getFluidInputs().stream().mapToLong(slot -> slot.getAmount()).sum());
        var outputs = new JsonArray();
        for (var slot : inventory.getFluidOutputs()) {
            var output = new JsonObject();
            output.addProperty("fluid", BuiltInRegistries.FLUID.getKey(slot.getResource().getFluid()).toString());
            output.addProperty("amount", slot.getAmount());
            outputs.add(output);
        }
        result.add("fluid_outputs", outputs);
        return result;
    }

    private static JsonObject replicator(aztech.modern_industrialization.machines.blockentities.ReplicatorMachineBlockEntity machine) {
        var input = machine.getInventory().getItemStacks().get(0);
        var output = machine.getInventory().getItemStacks().get(1);
        var matter = machine.getInventory().getFluidStacks().get(0);
        input.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(net.minecraft.world.item.Items.IRON_INGOT));
        input.setAmount(1);
        matter.setAmount(1000);
        var deliveries = new JsonArray();
        for (int tick = 1; tick <= 60; tick++) {
            machine.tick();
            if (output.getAmount() > 0) {
                var delivery = new JsonObject();
                delivery.addProperty("tick", tick);
                delivery.addProperty("items", output.getAmount());
                deliveries.add(delivery);
                output.empty();
            }
        }
        var result = new JsonObject();
        result.add("deliveries", deliveries);
        result.addProperty("template_remaining", input.getAmount());
        result.addProperty("uu_matter_consumed", 1000 - matter.getAmount());
        result.addProperty("template", "minecraft:iron_ingot");
        return result;
    }

    private static JsonObject waterPump(net.minecraft.world.level.block.Block block, MinecraftServer server) throws Exception {
        var level = server.overworld();
        var position = new BlockPos(32, 100, 16);
        level.getChunk(position);
        int[] dx = {-1, 0, 1, 1, 1, 0, -1, -1};
        int[] dz = {-1, -1, -1, 0, 1, 1, 1, 0};
        var positions = new java.util.ArrayList<BlockPos>();
        positions.add(position);
        for (int i = 0; i < 8; i++) positions.add(position.offset(dx[i], 0, dz[i]));
        for (var target : positions) if (!level.getBlockState(target).isAir()) throw new IllegalStateException("The temporary pump test area is occupied: " + target);
        try {
            level.setBlock(position, block.defaultBlockState(), 2);
            var pump = (aztech.modern_industrialization.machines.blockentities.AbstractWaterPumpBlockEntity) level.getBlockEntity(position);
            var multiplier = pump.getClass().getDeclaredMethod("getWaterMultiplier");
            multiplier.setAccessible(true);
            var sourceCount = aztech.modern_industrialization.machines.blockentities.AbstractWaterPumpBlockEntity.class.getDeclaredMethod("getWaterSourceCount");
            sourceCount.setAccessible(true);
            var samples = new JsonArray();
            for (int mask : new int[]{0, 1, 3, 255}) {
                for (int i = 0; i < 8; i++) level.setBlock(positions.get(i + 1),
                        ((mask >> i) & 1) != 0 ? net.minecraft.world.level.block.Blocks.WATER.defaultBlockState() : net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(), 2);
                var sample = new JsonObject();
                sample.addProperty("neighbor_mask", mask);
                sample.addProperty("source_count", (Integer) sourceCount.invoke(pump));
                samples.add(sample);
            }
            var fluids = pump.getInventory().getFluidStacks();
            var output = fluids.get(fluids.size() - 1);
            boolean electric = pump instanceof aztech.modern_industrialization.machines.blockentities.ElectricWaterPumpBlockEntity;
            if (electric) ((aztech.modern_industrialization.machines.blockentities.ElectricWaterPumpBlockEntity) pump).getEnergyComponent()
                    .insertEu(1000, aztech.modern_industrialization.util.Simulation.ACT);
            else fluids.get(0).setAmount(1000);
            var deliveries = new JsonArray();
            for (int tick = 1; tick <= 200; tick++) {
                pump.tick();
                if (output.getAmount() > 0) {
                    var delivery = new JsonObject();
                    delivery.addProperty("tick", tick);
                    delivery.addProperty("water_mb", output.getAmount());
                    deliveries.add(delivery);
                    output.empty();
                }
            }
            long remaining = electric ? ((aztech.modern_industrialization.machines.blockentities.ElectricWaterPumpBlockEntity) pump).getEnergyComponent().getEu() : fluids.get(0).getAmount();
            var result = new JsonObject();
            result.addProperty("water_multiplier", (Integer) multiplier.invoke(pump));
            result.addProperty("operation_ticks", 100);
            result.addProperty("energy_consumed_in_200_ticks", 1000 - remaining);
            result.addProperty("energy_resource", electric ? "energy:eu" : "fluid:modern_industrialization:steam");
            result.add("neighbor_samples", samples);
            result.add("deliveries", deliveries);
            return result;
        } finally {
            for (var target : positions) level.setBlock(target, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(), 2);
        }
    }

    private static JsonObject wasteCollector(net.minecraft.world.level.block.Block block, MinecraftServer server) {
        var level = server.overworld();
        var position = new BlockPos(32, 100, 32);
        level.getChunk(position);
        if (!level.getBlockState(position).isAir()) throw new IllegalStateException("The temporary waste collector area is occupied.");
        var animals = new java.util.ArrayList<net.minecraft.world.entity.animal.Cow>();
        var samples = new JsonArray();
        try {
            for (int count = 0; count <= 2; count++) {
                if (count > 0) {
                    var cow = net.minecraft.world.entity.EntityType.COW.create(level);
                    cow.setPos(position.getX() + .5, position.getY() + 1, position.getZ() + .5);
                    cow.setNoAi(true);
                    cow.setNoGravity(true);
                    if (!level.addFreshEntity(cow)) throw new IllegalStateException("The controlled cow could not be added.");
                    animals.add(cow);
                }
                level.setBlock(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(), 2);
                level.setBlock(position, block.defaultBlockState(), 2);
                var machine = (net.swedz.extended_industrialization.machines.blockentity.fluidharvesting.FluidHarvestingMachineBlockEntity) level.getBlockEntity(position);
                var electric = machine instanceof net.swedz.extended_industrialization.machines.blockentity.fluidharvesting.ElectricFluidHarvestingMachineBlockEntity;
                var energy = electric ? (aztech.modern_industrialization.machines.components.EnergyComponent) ((net.swedz.extended_industrialization.machines.blockentity.fluidharvesting.ElectricFluidHarvestingMachineBlockEntity) machine).getEnergyComponent() : null;
                var fluids = machine.getInventory().getFluidStacks();
                var output = fluids.getLast();
                long consumed = 0;
                var deliveries = new JsonArray();
                for (int tick = 1; tick <= 600; tick++) {
                    if (electric) energy.insertEu(energy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                    else fluids.getFirst().setAmount(8000);
                    long before = electric ? energy.getEu() : fluids.getFirst().getAmount();
                    machine.tick();
                    consumed += before - (electric ? energy.getEu() : fluids.getFirst().getAmount());
                    if (output.getAmount() > 0) {
                        var delivery = new JsonObject();
                        delivery.addProperty("tick", tick);
                        delivery.addProperty("amount_mb", output.getAmount());
                        deliveries.add(delivery);
                        output.empty();
                    }
                }
                var sample = new JsonObject();
                sample.addProperty("animals", count);
                sample.addProperty("energy_consumed", consumed);
                sample.addProperty("energy_resource", electric ? "energy:eu" : "fluid:modern_industrialization:steam");
                sample.add("deliveries", deliveries);
                samples.add(sample);
            }
            var result = new JsonObject();
            result.add("samples", samples);
            result.addProperty("test_ticks", 600);
            result.addProperty("animal_type", "minecraft:cow");
            return result;
        } finally {
            for (var cow : animals) cow.discard();
            level.setBlock(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(), 2);
        }
    }

    @SuppressWarnings("unchecked")
    private static JsonObject energyHatchTransfer(aztech.modern_industrialization.machines.blockentities.hatches.EnergyHatch hatch,
            MinecraftServer server) throws Exception {
        var result = new JsonObject();
        result.addProperty("scope", "Actual cable-network ticks with injected adjacent storage adapters; no placed cable topology claim.");
        var energy = hatch.getEnergyComponent();
        long original = energy.getEu();
        var tier = hatch.getCableTier();
        var inputField = aztech.modern_industrialization.machines.blockentities.hatches.EnergyHatch.class.getDeclaredField("input");
        inputField.setAccessible(true);
        boolean input = inputField.getBoolean(hatch);
        var field = aztech.modern_industrialization.machines.blockentities.hatches.EnergyHatch.class.getDeclaredField(input ? "insertable" : "extractable");
        field.setAccessible(true);
        var adapter = (aztech.modern_industrialization.api.energy.MIEnergyStorage) field.get(hatch);
        var other = new aztech.modern_industrialization.machines.components.EnergyComponent(hatch, tier.getMaxTransfer() * 100);
        var peer = input ? other.buildExtractable(value -> value == tier) : other.buildInsertable(value -> value == tier);
        var samples = new JsonArray();
        try {
            for (int count : new int[] {1, 2}) {
                var nodes = new java.util.ArrayList<aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode>();
                for (int i = 0; i < count; i++) {
                    final boolean connected = i == 0;
                    var node = new aztech.modern_industrialization.pipes.electricity.ElectricityNetworkNode() {
                        @Override public void appendAttributes(net.minecraft.server.level.ServerLevel world, BlockPos pos,
                                aztech.modern_industrialization.api.energy.CableTier cableTier,
                                java.util.List<aztech.modern_industrialization.api.energy.MIEnergyStorage> storages) {
                            if (connected) { storages.add(adapter); storages.add(peer); }
                        }
                    };
                    nodes.add(new aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode(new BlockPos(i, 0, 0), node));
                }
                var network = new aztech.modern_industrialization.pipes.electricity.ElectricityNetwork(0, null, tier) {
                    @Override public java.util.Collection<aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode> iterateTickingNodes() { return nodes; }
                };
                long moved = 0;
                for (int tick = 0; tick < 20; tick++) {
                    energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    other.consumeEu(other.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    if (input) other.insertEu(other.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                    else energy.insertEu(energy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                    network.tick(server.overworld());
                    long transferred = input ? energy.getEu() : other.getEu();
                    if (transferred != tier.getMaxTransfer()) throw new IllegalStateException("Cable network transfer differs from its loaded limit.");
                    moved += transferred;
                }
                var sample = new JsonObject();
                sample.addProperty("network_nodes", count);
                sample.addProperty("ticks", 20);
                sample.addProperty("transferred_eu", moved);
                samples.add(sample);
            }
        } finally {
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            energy.insertEu(original, aztech.modern_industrialization.util.Simulation.ACT);
        }
        result.add("samples", samples);
        return result;
    }

    private static JsonObject teslaTower(MachineBlockEntity prototype, MinecraftServer server) throws Exception {
        var tower = (net.swedz.extended_industrialization.machines.blockentity.multiblock.teslatower.TeslaTowerBlockEntity) prototype;
        var inputsField = tower.getClass().getDeclaredField("energyInputs");
        inputsField.setAccessible(true);
        var inputs = (java.util.List<aztech.modern_industrialization.machines.components.EnergyComponent>) inputsField.get(tower);
        var originalInputs = new java.util.ArrayList<>(inputs);
        var matcherField = aztech.modern_industrialization.machines.multiblocks.MultiblockMachineBlockEntity.class.getDeclaredField("shapeMatcher");
        matcherField.setAccessible(true);
        var originalMatcher = matcherField.get(tower);
        aztech.modern_industrialization.machines.components.ActiveShapeComponent shape = null;
        aztech.modern_industrialization.machines.components.IsActiveComponent active = null;
        for (var component : tower.components) {
            if (component instanceof aztech.modern_industrialization.machines.components.ActiveShapeComponent value) shape = value;
            if (component instanceof aztech.modern_industrialization.machines.components.IsActiveComponent value) active = value;
        }
        if (shape == null || active == null) throw new IllegalStateException("Tesla tower components are missing.");
        var indexField = shape.getClass().getDeclaredField("activeShape");
        indexField.setAccessible(true);
        int originalIndex = shape.getActiveShapeIndex();
        boolean originalValid = tower.shapeValid.shapeValid;
        boolean originalActive = active.isActive;
        var first = new aztech.modern_industrialization.machines.components.EnergyComponent(tower, 1000000000000L);
        var second = new aztech.modern_industrialization.machines.components.EnergyComponent(tower, 1000000000000L);
        var samples = new JsonArray();
        try {
            inputs.clear(); inputs.add(first); inputs.add(second);
            // This isolates controller ticking. It does not establish that a placed structure matches.
            matcherField.set(tower, new aztech.modern_industrialization.machines.multiblocks.ShapeMatcher(
                    server.overworld(), tower.getBlockPos(), tower.getOrientation().facingDirection, tower.getActiveShape(), tower.shapeValid) {
                @Override public boolean needsRematch() { return false; }
            });
            for (int index = 0; index < shape.shapeTemplates.length; index++) {
                indexField.setInt(shape, index);
                long drain = tower.getPassiveDrain();
                var sample = new JsonObject();
                sample.addProperty("shape", index);
                sample.addProperty("passive_eu_per_tick", drain);
                sample.addProperty("max_transfer_eu_per_tick", tower.getMaxTransfer());
                sample.addProperty("max_axis_distance", tower.getMaxDistance());
                tower.shapeValid.shapeValid = true;
                long consumed = 0;
                for (int tick = 0; tick < 20; tick++) {
                    first.consumeEu(first.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    second.consumeEu(second.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    first.insertEu(drain / 2, aztech.modern_industrialization.util.Simulation.ACT);
                    second.insertEu(drain - drain / 2, aztech.modern_industrialization.util.Simulation.ACT);
                    tower.tick();
                    consumed += drain - first.getEu() - second.getEu();
                    if (!active.isActive) throw new IllegalStateException("A supplied Tesla tower did not become active.");
                }
                sample.addProperty("idle_energy_for_20_ticks", consumed);
                first.insertEu(drain - 1, aztech.modern_industrialization.util.Simulation.ACT);
                tower.tick();
                sample.addProperty("undersupplied_energy_consumed", drain - 1 - first.getEu());
                sample.addProperty("undersupplied_active", active.isActive);
                first.insertEu(drain, aztech.modern_industrialization.util.Simulation.ACT);
                tower.shapeValid.shapeValid = false;
                tower.tick();
                sample.addProperty("invalid_shape_energy_consumed", drain - first.getEu());
                sample.addProperty("invalid_shape_active", active.isActive);
                first.consumeEu(first.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                samples.add(sample);
            }
            var result = new JsonObject();
            result.addProperty("scope", "Controller ticks with injected shape validity and energy components; no receivers or formed-world geometry claim.");
            result.add("tiers", samples);
            return result;
        } finally {
            indexField.setInt(shape, originalIndex);
            matcherField.set(tower, originalMatcher);
            inputs.clear(); inputs.addAll(originalInputs);
            tower.shapeValid.shapeValid = originalValid;
            active.isActive = originalActive;
        }
    }

    @SuppressWarnings("unchecked")
    private static JsonArray irradiationCycles(MachineBlockEntity prototype, MinecraftServer server) throws Exception {
        var result = new JsonArray();
        var sourceField = prototype.getClass().getDeclaredField("neutronSource");
        var hatchesField = prototype.getClass().getDeclaredField("nuclearHatches");
        var absorb = prototype.getClass().getDeclaredMethod("absorb");
        var consume = prototype.getClass().getDeclaredMethod("consumeEu", aztech.modern_industrialization.util.Simulation.class);
        sourceField.setAccessible(true); hatchesField.setAccessible(true); absorb.setAccessible(true); consume.setAccessible(true);
        var levelData = (net.minecraft.world.level.storage.ServerLevelData) server.overworld().getLevelData();
        long previousTime = levelData.getGameTime();
        var sourceMap = BuiltInRegistries.ITEM.getDataMap(
                me.luligabi.yet_another_industrialization.common.misc.datamap.YAIDataMaps.INSTANCE.getIRRADIATOR_NEUTRON_SOURCE());
        var hatchBlock = (EntityBlock) BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:nuclear_item_hatch"));
        try {
            for (var entry : sourceMap.entrySet()) {
                for (var item : BuiltInRegistries.ITEM) {
                    if (!(item instanceof aztech.modern_industrialization.nuclear.NuclearFuel fuel)) continue;
                    for (int count : new int[]{1, 8}) {
                        var machine = (MachineBlockEntity) ((EntityBlock) prototype.getBlockState().getBlock())
                                .newBlockEntity(BlockPos.ZERO, prototype.getBlockState());
                        machine.setLevel(server.overworld());
                        sourceField.set(machine, entry.getValue());
                        var inventory = (aztech.modern_industrialization.machines.components.MultiblockInventoryComponent)
                                ((aztech.modern_industrialization.api.machine.holder.MultiblockInventoryComponentHolder) machine).getMultiblockInventoryComponent();
                        var sourceSlot = aztech.modern_industrialization.inventory.ConfigurableItemStack.standardInputSlot();
                        sourceSlot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(BuiltInRegistries.ITEM.get(entry.getKey())));
                        sourceSlot.setAmount(1);
                        inventory.getItemInputs().add(sourceSlot);
                        var hatches = (java.util.List<aztech.modern_industrialization.machines.blockentities.hatches.NuclearHatch>) hatchesField.get(machine);
                        for (int index = 0; index < count; index++) {
                            var hatch = (aztech.modern_industrialization.machines.blockentities.hatches.NuclearHatch) hatchBlock.newBlockEntity(BlockPos.ZERO,
                                    ((net.minecraft.world.level.block.Block) hatchBlock).defaultBlockState());
                            var slot = hatch.getInventory().getItemStacks().getFirst();
                            slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(item));
                            slot.setAmount(1);
                            hatches.add(hatch);
                        }
                        var energy = new aztech.modern_industrialization.machines.components.EnergyComponent(machine, 1000000000L);
                        ((java.util.List<aztech.modern_industrialization.machines.components.EnergyComponent>)
                                ((aztech.modern_industrialization.api.machine.holder.EnergyListComponentHolder) machine).getEnergyComponents()).add(energy);
                        energy.insertEu(energy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                        int ticks = 0, sourcesUsed = 0;
                        while (hatches.getFirst().getInventory().getItemStacks().getFirst().getAmount() > 0 && ticks < 100000) {
                            levelData.setGameTime(++ticks);
                            if (sourceSlot.getAmount() == 0) {
                                sourcesUsed++;
                                sourceSlot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(BuiltInRegistries.ITEM.get(entry.getKey())));
                                sourceSlot.setAmount(1);
                            }
                            sourceField.set(machine, entry.getValue());
                            if (!(Boolean) consume.invoke(machine, aztech.modern_industrialization.util.Simulation.SIMULATE)) throw new IllegalStateException("Irradiation reference ran out of power.");
                            absorb.invoke(machine);
                            consume.invoke(machine, aztech.modern_industrialization.util.Simulation.ACT);
                        }
                        if (ticks == 100000) throw new IllegalStateException("Irradiation reference did not finish.");
                        var record = new JsonObject();
                        record.addProperty("source", entry.getKey().location().toString());
                        record.addProperty("fuel", BuiltInRegistries.ITEM.getKey(item).toString());
                        record.addProperty("hatches", count);
                        record.addProperty("completion_tick", ticks);
                        record.addProperty("energy_consumed", energy.getCapacity() - energy.getEu());
                        record.addProperty("output_amount", hatches.stream().mapToLong(hatch -> hatch.getInventory().getItemStacks().stream()
                                .skip(1).mapToLong(slot -> slot.getAmount()).sum()).sum());
                        record.addProperty("source_items_consumed_sample", sourcesUsed + (sourceSlot.getAmount() == 0 ? 1 : 0));
                        record.addProperty("source_damage_sample", sourceSlot.toStack().getDamageValue());
                        if (entry.getValue().getType().getSerializedName().equals("lifespan") && count == 1
                                && BuiltInRegistries.ITEM.getKey(item).toString().equals("modern_industrialization:uranium_fuel_rod")) {
                            while (sourceSlot.getAmount() > 0 && ticks < 100000) {
                                levelData.setGameTime(++ticks);
                                absorb.invoke(machine);
                                consume.invoke(machine, aztech.modern_industrialization.util.Simulation.ACT);
                            }
                            if (sourceSlot.getAmount() > 0) throw new IllegalStateException("The irradiation source did not wear out.");
                            record.addProperty("source_lifetime_ticks", ticks);
                            record.addProperty("energy_through_source_lifetime", energy.getCapacity() - energy.getEu());
                        }
                        result.add(record);
                    }
                }
            }
        } finally { levelData.setGameTime(previousTime); }
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
                if (id.equals("yet_another_industrialization:nuclear_rod_irradiator")) record.add("irradiation_probe", irradiationCycles(machine, server));
                if (id.equals("yet_another_industrialization:dragon_egg_energy_siphon")
                        || id.equals("yet_another_industrialization:pulse_detonation_generator")) {
                    record.add("recipe_generation_probe", recipeGeneration(machine, server));
                }
                if (entity instanceof aztech.modern_industrialization.machines.blockentities.ReplicatorMachineBlockEntity replicator) record.add("replication_probe", replicator(replicator));
                if (entity instanceof aztech.modern_industrialization.machines.blockentities.AbstractWaterPumpBlockEntity) record.add("water_pump_probe", waterPump(block, server));
                if (id.matches("extended_industrialization:(bronze|steel|electric)_waste_collector")) record.add("waste_collector_probe", wasteCollector(block, server));
                if (id.equals("extended_industrialization:tesla_tower")) record.add("tesla_tower_probe", teslaTower(machine, server));
                if (entity instanceof aztech.modern_industrialization.machines.multiblocks.HatchBlockEntity hatch) {
                    record.addProperty("role", "multiblock_part");
                    record.addProperty("hatch_type", hatch.getHatchType().id().toString());
                    record.addProperty("upgrades_steam_to_steel", hatch.upgradesToSteel());
                    var capacities = new JsonObject();
                    var itemSlots = new JsonArray();
                    for (var slot : hatch.getInventory().getItemStacks()) itemSlots.add(slot.getCapacity());
                    var fluidSlots = new JsonArray();
                    for (var slot : hatch.getInventory().getFluidStacks()) fluidSlots.add(slot.getCapacity());
                    capacities.add("item_slots", itemSlots);
                    capacities.add("fluid_slots_mb", fluidSlots);
                    if (hatch instanceof aztech.modern_industrialization.api.machine.holder.EnergyComponentHolder energy) {
                        capacities.addProperty("energy_eu", energy.getEnergyComponent().getCapacity());
                    }
                    if (hatch instanceof aztech.modern_industrialization.api.energy.CableTierHolder cable) {
                        capacities.addProperty("nominal_eu", cable.getCableTier().getEu());
                        capacities.addProperty("cable_eu_per_tick", cable.getCableTier().getMaxTransfer());
                    }
                    if (id.startsWith("modern_industrialization:") && hatch instanceof aztech.modern_industrialization.machines.blockentities.hatches.EnergyHatch energyHatch)
                        record.add("energy_hatch_transfer_probe", energyHatchTransfer(energyHatch, server));
                    record.add("hatch_capacity", capacities);
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
                        var componentShapes = shapes(component, server);
                        if (!componentShapes.isEmpty()) {
                            shapeRecords = componentShapes;
                            record.add("shapes", shapeRecords);
                        }
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
                if (id.equals("extended_industrialization:large_electric_furnace") || id.equals("industrialization_overdrive:pyrolyse_oven")) {
                    var tiers = new JsonArray();
                    for (var tier : (java.util.List<?>) entity.getClass().getMethod("getTiers").invoke(null)) {
                        var value = new JsonObject();
                        value.addProperty("coil", tier.getClass().getMethod("blockId").invoke(tier).toString());
                        value.addProperty("batch_limit", (Integer) tier.getClass().getMethod("batchSize").invoke(tier));
                        value.addProperty("energy_multiplier", (Float) tier.getClass().getMethod("euCostMultiplier").invoke(tier));
                        tiers.add(value);
                    }
                    record.add("batch_tiers", tiers);
                }
                record.addProperty("nbt", entity.saveWithFullMetadata(server.registryAccess()).toString());
                if (entity instanceof aztech.modern_industrialization.machines.blockentities.BoilerMachineBlockEntity
                        || entity instanceof aztech.modern_industrialization.machines.blockentities.multiblocks.SteamBoilerMultiblockBlockEntity) {
                    record.add("coal_warmup_probe", boilerWarmup(machine, server, null, false));
                    record.add("diesel_heavy_water_warmup_probe", boilerWarmup(machine, server, "modern_industrialization:diesel", true));
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
        result.add("shape_member_rules", shapeMemberRules);
        result.add("failures", failures);
        result.add("arithmetic", arithmetic);
        result.add("item_rules", itemRules(server));
        result.add("ingredient_rules", ingredientRules(server));
        result.add("crafting_rules", craftingRules(server));
        result.add("progression_chapters", progressionChapters());
        result.add("integration_data_maps", integrationDataMaps(server));
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
