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
        event.getDispatcher().register(Commands.literal("planner_fixture_rotation")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return createRotationFixture(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_solar")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return captureSolarPanels(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_solar_roof")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return checkSolarRoofs(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_fixture_storage")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return createStorageFixture(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_blasting")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return captureBlasting(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_fixture_blasting_save")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return createBlastingSaveFixture(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_crystallarieum")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return captureCrystallarieum(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_spectrum_automation")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return captureSpectrumAutomation(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
        event.getDispatcher().register(Commands.literal("planner_probe_turtle_growth")
                .requires(source -> source.hasPermission(4))
                .executes(context -> {
                    try { return captureTurtleGrowth(context.getSource().getServer()); }
                    catch (Exception error) { error.printStackTrace(); return 0; }
                }));
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

    private static int captureCrystallarieum(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var position = new BlockPos(640, 160, 0);
        var above = position.above();
        if (!level.getBlockState(position).isAir() || !level.getBlockState(above).isAir()) {
            throw new IllegalStateException("The Crystallarieum probe area is occupied.");
        }
        var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("spectrum:crystallarieum"));
        var liquid = BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse("spectrum:liquid_crystal"));
        var rawIron = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:raw_iron"));
        var brown = de.dafuqs.spectrum.api.ink.color.InkColor.ofIdString("spectrum:brown").orElseThrow();
        level.setBlockAndUpdate(position, block.defaultBlockState());
        var machine = (de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity) level.getBlockEntity(position);
        var report = new JsonObject();
        var samples = new JsonArray();
        try {
            machine.getFluidTank().setFluid(new net.neoforged.neoforge.fluids.FluidStack(liquid, 1000));
            machine.getInkStorage().addEnergy(brown, 10000);
            for (int cycle = 0; cycle < 2; cycle++) {
                var starter = new net.minecraft.world.item.ItemStack(rawIron);
                machine.acceptStack(starter, false, null);
                if (!starter.isEmpty()) throw new IllegalStateException("Raw iron starter was not consumed.");
                if (cycle == 0) {
                    for (int tick = 0; tick < 20; tick++) {
                        de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity.serverTick(
                                level, position, level.getBlockState(position), machine);
                    }
                    report.addProperty("without_additive_nbt", machine.saveWithFullMetadata(server.registryAccess()).toString());
                    if (!level.getBlockState(above).is(BuiltInRegistries.BLOCK.get(
                            net.minecraft.resources.ResourceLocation.parse("spectrum:small_iron_bud")))) {
                        throw new IllegalStateException("The no-additive bud changed unexpectedly.");
                    }
                    var nuggets = new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_NUGGET, 64);
                    machine.acceptStack(nuggets, false, null);
                    if (!nuggets.isEmpty()) throw new IllegalStateException("The additive stack was not accepted.");
                }
                int[] ticks = {0, 299, 300, 599, 600};
                int elapsed = 0;
                for (int checkpoint : ticks) {
                    while (elapsed < checkpoint) {
                        de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity.serverTick(
                                level, position, level.getBlockState(position), machine);
                        elapsed++;
                    }
                    var sample = new JsonObject();
                    sample.addProperty("cycle", cycle);
                    sample.addProperty("tick", elapsed);
                    sample.addProperty("block", BuiltInRegistries.BLOCK.getKey(level.getBlockState(above).getBlock()).toString());
                    sample.addProperty("ink_remaining", machine.getInkStorage().getEnergy(brown));
                    sample.addProperty("additive_remaining", machine.getItem(0).getCount());
                    sample.addProperty("fluid_remaining_mb", machine.getFluidTank().getFluidAmount());
                    sample.addProperty("nbt", machine.saveWithFullMetadata(server.registryAccess()).toString());
                    samples.add(sample);
                }
                if (!level.getBlockState(above).is(BuiltInRegistries.BLOCK.get(
                        net.minecraft.resources.ResourceLocation.parse("spectrum:iron_cluster")))) {
                    throw new IllegalStateException("The iron cluster did not mature on the loaded server.");
                }
                if (!level.getBlockState(above).is(net.minecraft.tags.BlockTags.MINEABLE_WITH_PICKAXE)) {
                    throw new IllegalStateException("The mature cluster is not pickaxe mineable.");
                }
                var drops = net.minecraft.world.level.block.Block.getDrops(
                        level.getBlockState(above), level, above, null, null,
                        new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_PICKAXE));
                var harvest = new JsonArray();
                for (var drop : drops) {
                    var value = new JsonObject();
                    value.addProperty("item", BuiltInRegistries.ITEM.getKey(drop.getItem()).toString());
                    value.addProperty("count", drop.getCount());
                    harvest.add(value);
                }
                if (harvest.size() != 1
                        || !harvest.get(0).getAsJsonObject().get("item").getAsString().equals("spectrum:pure_iron")
                        || harvest.get(0).getAsJsonObject().get("count").getAsInt() < 3
                        || harvest.get(0).getAsJsonObject().get("count").getAsInt() > 5) {
                    throw new IllegalStateException("The mature cluster did not yield the loaded pure-iron loot.");
                }
                if (machine.getInkStorage().getEnergy(brown) != 10000 - 240L * (cycle + 1)
                        || machine.getFluidTank().getFluidAmount() != 1000) {
                    throw new IllegalStateException("The loaded growth did not match its ink and fluid balance.");
                }
                report.add("harvest_" + cycle, harvest);
                level.setBlockAndUpdate(above, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
                machine.onTopBlockChange(level.getBlockState(above), null);
            }
            report.add("samples", samples);
            var pickerPosition = new BlockPos(644, 160, 0);
            if (!level.getBlockState(pickerPosition).isAir()) {
                throw new IllegalStateException("The Color Picker probe area is occupied.");
            }
            var pickerBlock = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("spectrum:color_picker"));
            level.setBlockAndUpdate(pickerPosition, pickerBlock.defaultBlockState());
            try {
                var picker = (de.dafuqs.spectrum.blocks.ink.gen.ColorPickerBlockEntity) level.getBlockEntity(pickerPosition);
                picker.setItem(1, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BROWN_DYE, 3));
                var pickerSamples = new JsonArray();
                for (int operation = 0; operation < 3; operation++) {
                    if (!picker.tickLogic(level)) throw new IllegalStateException("The loaded Color Picker did not accept brown dye.");
                    var sample = new JsonObject();
                    sample.addProperty("operation", operation + 1);
                    sample.addProperty("brown_ink", picker.getInkStorage().getEnergy(brown));
                    sample.addProperty("dye_remaining", picker.getItem(1).getCount());
                    pickerSamples.add(sample);
                }
                if (picker.getInkStorage().getEnergy(brown) != 15 || !picker.getItem(1).isEmpty()) {
                    throw new IllegalStateException("The loaded Color Picker did not convert three dyes into 15 ink.");
                }
                report.add("color_picker", pickerSamples);
            } finally {
                level.setBlockAndUpdate(pickerPosition, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            }
            Files.createDirectories(Path.of("planner-extraction"));
            Files.writeString(Path.of("planner-extraction/crystallarieum.json"),
                    new GsonBuilder().setPrettyPrinting().create().toJson(report));
            System.out.println("Planner Crystallarieum measured two complete growth and harvest cycles.");
            return 1;
        } finally {
            level.setBlockAndUpdate(above, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        }
    }

    private static int captureSpectrumAutomation(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var position = new BlockPos(672, 160, 0);
        var pickerPosition = position.east(4);
        var machineNodePosition = position.east();
        var pickerNodePosition = pickerPosition.east();
        var planePosition = position.above(2);
        var storagePosition = planePosition.east();
        var chestPosition = storagePosition.east();
        var cellPosition = planePosition.west();
        var acceptorPosition = cellPosition.above();
        for (var place : new BlockPos[]{position, position.above(), pickerPosition,
                machineNodePosition, pickerNodePosition, planePosition, storagePosition,
                chestPosition, cellPosition, acceptorPosition}) {
            if (!level.getBlockState(place).isAir())
                throw new IllegalStateException("The Spectrum automation probe area is occupied.");
        }
        var machineBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.CRYSTALLARIEUM.get();
        var pickerBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.COLOR_PICKER.get();
        var nodeBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.INK_NODE.get();
        var liquid = BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse("spectrum:liquid_crystal"));
        var brown = de.dafuqs.spectrum.api.ink.color.InkColor.ofIdString("spectrum:brown").orElseThrow();
        var report = new JsonObject();
        level.setBlockAndUpdate(position, machineBlock.defaultBlockState());
        level.setBlockAndUpdate(pickerPosition, pickerBlock.defaultBlockState());
        level.setBlockAndUpdate(machineNodePosition, nodeBlock.defaultBlockState().setValue(
                de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlock.FACING,
                net.minecraft.core.Direction.EAST));
        level.setBlockAndUpdate(pickerNodePosition, nodeBlock.defaultBlockState().setValue(
                de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlock.FACING,
                net.minecraft.core.Direction.EAST));
        level.setBlockAndUpdate(planePosition, appeng.core.definitions.AEBlocks.CABLE_BUS.block().defaultBlockState());
        level.setBlockAndUpdate(storagePosition, appeng.core.definitions.AEBlocks.CABLE_BUS.block().defaultBlockState());
        level.setBlockAndUpdate(chestPosition, net.minecraft.world.level.block.Blocks.CHEST.defaultBlockState());
        level.setBlockAndUpdate(cellPosition, appeng.core.definitions.AEBlocks.ENERGY_CELL.block().defaultBlockState());
        level.setBlockAndUpdate(acceptorPosition, appeng.core.definitions.AEBlocks.ENERGY_ACCEPTOR.block().defaultBlockState());
        try {
            var machine = (de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity)
                    level.getBlockEntity(position);
            var picker = (de.dafuqs.spectrum.blocks.ink.gen.ColorPickerBlockEntity)
                    level.getBlockEntity(pickerPosition);
            var machineNode = (de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlockEntity)
                    level.getBlockEntity(machineNodePosition);
            var pickerNode = (de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlockEntity)
                    level.getBlockEntity(pickerNodePosition);
            var planeCable = (appeng.blockentity.networking.CableBusBlockEntity) level.getBlockEntity(planePosition);
            var storageCable = (appeng.blockentity.networking.CableBusBlockEntity) level.getBlockEntity(storagePosition);
            planeCable.addPart(appeng.core.definitions.AEParts.GLASS_CABLE.item(appeng.api.util.AEColor.TRANSPARENT), null, null);
            storageCable.addPart(appeng.core.definitions.AEParts.GLASS_CABLE.item(appeng.api.util.AEColor.TRANSPARENT), null, null);
            var plane = planeCable.addPart(appeng.core.definitions.AEParts.ANNIHILATION_PLANE.get(),
                    net.minecraft.core.Direction.DOWN, null);
            var storage = storageCable.addPart(appeng.core.definitions.AEParts.STORAGE_BUS.get(),
                    net.minecraft.core.Direction.EAST, null);
            storage.getConfig().setStack(0, new appeng.api.stacks.GenericStack(
                    appeng.api.stacks.AEItemKey.of(BuiltInRegistries.ITEM.get(
                            net.minecraft.resources.ResourceLocation.parse("spectrum:pure_iron"))), 1));
            var chest = (net.minecraft.world.level.block.entity.ChestBlockEntity) level.getBlockEntity(chestPosition);
            var cell = (appeng.blockentity.networking.EnergyCellBlockEntity) level.getBlockEntity(cellPosition);
            var acceptor = (appeng.blockentity.networking.EnergyAcceptorBlockEntity) level.getBlockEntity(acceptorPosition);
            planeCable.onReady();
            storageCable.onReady();
            cell.onReady();
            acceptor.onReady();
            var grid = (appeng.me.Grid) cell.getMainNode().getGrid();
            if (grid != plane.getMainNode().getGrid() || grid != storage.getMainNode().getGrid())
                throw new IllegalStateException("The placed Spectrum harvest grid is disconnected.");
            machine.getFluidTank().setFluid(new net.neoforged.neoforge.fluids.FluidStack(liquid, 1000));
            picker.setItem(1, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BROWN_DYE, 64));
            machineNode.connectToNearbyNodes(null);
            pickerNode.connectToNearbyNodes(null);
            if (machineNode.getServerNetwork().isEmpty() || pickerNode.getServerNetwork().isEmpty()
                    || machineNode.getServerNetwork().get() != pickerNode.getServerNetwork().get())
                throw new IllegalStateException("The placed ink nodes did not form one network.");
            var earlyStarter = new net.minecraft.world.entity.item.ItemEntity(level,
                    position.getX() + 0.5, position.getY() + 1, position.getZ() + 0.5,
                    new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.RAW_IRON));
            machineBlock.fallOn(level, level.getBlockState(position), position, earlyStarter, 1);
            if (!earlyStarter.getItem().isEmpty() || !level.getBlockState(position.above()).is(BuiltInRegistries.BLOCK.get(
                    net.minecraft.resources.ResourceLocation.parse("spectrum:small_iron_bud"))))
                throw new IllegalStateException("The control bud did not plant.");
            int earlyRemovedTick = -1;
            for (int tick = 1; tick <= 200; tick++) {
                acceptor.injectExternalPower(appeng.api.config.PowerUnit.FE, 403200,
                        appeng.api.config.Actionable.MODULATE);
                grid.onServerStartTick();
                grid.onLevelStartTick(level);
                grid.onLevelEndTick(level);
                grid.onServerEndTick();
                if (level.getBlockState(position.above()).isAir()) {
                    earlyRemovedTick = tick;
                    break;
                }
            }
            if (earlyRemovedTick < 0)
                throw new IllegalStateException("The continuously active plane did not clear the immature control bud.");
            for (int slot = 0; slot < chest.getContainerSize(); slot++)
                if (!chest.getItem(slot).isEmpty())
                    throw new IllegalStateException("The immature control bud reached the filtered output chest.");
            report.addProperty("always_on_removed_small_bud_after_ticks", earlyRemovedTick);
            var transfer = new JsonArray();
            var cycles = new JsonArray();
            report.addProperty("grid_idle_ae_per_tick", grid.getEnergyService().getIdlePowerUsage());
            for (int cycle = 0; cycle < 2; cycle++) {
                var starter = new net.minecraft.world.entity.item.ItemEntity(level,
                        position.getX() + 0.5, position.getY() + 1, position.getZ() + 0.5,
                        new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.RAW_IRON));
                machineBlock.fallOn(level, level.getBlockState(position), position, starter, 1);
                if (!starter.getItem().isEmpty())
                    throw new IllegalStateException("The dropped starter was not accepted.");
                if (cycle == 0) {
                    var additive = new net.minecraft.world.entity.item.ItemEntity(level,
                            position.getX() + 0.5, position.getY() + 1, position.getZ() + 0.5,
                            new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_NUGGET, 64));
                    machineBlock.fallOn(level, level.getBlockState(position), position, additive, 1);
                    if (!additive.getItem().isEmpty())
                        throw new IllegalStateException("The dropped additive was not accepted.");
                }
                int ticks = 0;
                int matureTick = -1;
                long harvested = 0;
                double energy = 0;
                while (harvested == 0 && ticks < 2000) {
                    if (cycle == 1 && ticks == 1)
                        picker.setItem(1, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BROWN_DYE, 64));
                    if (ticks % 5 == 0) picker.tickLogic(level);
                    de.dafuqs.spectrum.blocks.pastel_network.network.ServerPastelNetworkManager.get(level).tick();
                    de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity.serverTick(
                            level, position, level.getBlockState(position), machine);
                    if (matureTick < 0 && level.getBlockState(position.above()).is(BuiltInRegistries.BLOCK.get(
                            net.minecraft.resources.ResourceLocation.parse("spectrum:iron_cluster"))))
                        matureTick = ticks + 1;
                    if (matureTick >= 0) {
                        acceptor.injectExternalPower(appeng.api.config.PowerUnit.FE, 403200,
                                appeng.api.config.Actionable.MODULATE);
                        double before = cell.getAECurrentPower();
                        grid.onServerStartTick();
                        grid.onLevelStartTick(level);
                        grid.onLevelEndTick(level);
                        grid.onServerEndTick();
                        energy += before - cell.getAECurrentPower();
                    }
                    for (int slot = 0; slot < chest.getContainerSize(); slot++) {
                        var stack = chest.getItem(slot);
                        if (!stack.isEmpty()) {
                            if (!BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().equals("spectrum:pure_iron"))
                                throw new IllegalStateException("The harvest chest received a different item.");
                            harvested += stack.getCount();
                            chest.setItem(slot, net.minecraft.world.item.ItemStack.EMPTY);
                        }
                    }
                    ticks++;
                    if (ticks == 1 || ticks == 100 || ticks == 600 || ticks == 1000) {
                        var sample = new JsonObject();
                        sample.addProperty("cycle", cycle);
                        sample.addProperty("tick", ticks);
                        sample.addProperty("picker_ink", picker.getInkStorage().getEnergy(brown));
                        sample.addProperty("machine_ink", machine.getInkStorage().getEnergy(brown));
                        transfer.add(sample);
                    }
                }
                if (ticks >= 2000)
                    throw new IllegalStateException("The ink-fed cluster did not mature in 2,000 ticks: block="
                            + BuiltInRegistries.BLOCK.getKey(level.getBlockState(position.above()).getBlock())
                            + ", picker_ink=" + picker.getInkStorage().getEnergy(brown)
                            + ", machine_ink=" + machine.getInkStorage().getEnergy(brown)
                            + ", dyes=" + picker.getItem(1).getCount()
                            + ", additive=" + machine.getItem(0).getCount()
                            + ", network=" + machineNode.getServerNetwork().isPresent()
                            + ", plane_active=" + plane.getMainNode().isActive()
                            + ", mature_tick=" + matureTick);
                var result = new JsonObject();
                result.addProperty("cycle", cycle);
                result.addProperty("growth_ticks", ticks);
                result.addProperty("mature_tick", matureTick);
                result.addProperty("harvested", harvested);
                result.addProperty("network_energy_ae", energy);
                result.addProperty("plane_active", plane.getMainNode().isActive());
                result.addProperty("top_cleared", level.getBlockState(position.above()).isAir());
                result.addProperty("picker_ink", picker.getInkStorage().getEnergy(brown));
                result.addProperty("machine_ink", machine.getInkStorage().getEnergy(brown));
                result.addProperty("additive_remaining", machine.getItem(0).getCount());
                result.addProperty("dyes_remaining", picker.getItem(1).getCount());
                cycles.add(result);
                if (!level.getBlockState(position.above()).isAir() || harvested < 3 || harvested > 5)
                    throw new IllegalStateException("The placed AE2 plane did not clear and collect the mature cluster.");
            }
            report.add("ink_transfer", transfer);
            report.add("cycles", cycles);
            report.addProperty("pickup_control", "The isolated fixture ticks the placed AE2 grid only after the crop reaches its mature cluster state. A continuous always-on grid harvested immature buds before they could grow.");
            report.addProperty("fluid_remaining_mb", machine.getFluidTank().getFluidAmount());
            var loadedRecipes = new java.util.ArrayList<>(server.getRecipeManager().getAllRecipesFor(
                    de.dafuqs.spectrum.registries.SpectrumRecipeTypes.CRYSTALLARIEUM));
            loadedRecipes.sort(java.util.Comparator.comparing(holder -> holder.id().toString()));
            var lootSamples = new JsonArray();
            for (var holder : loadedRecipes) {
                var stage = holder.value().getGrowthStages().getLast();
                level.setBlockAndUpdate(position.above(), stage);
                var drops = net.minecraft.world.level.block.Block.getDrops(stage, level, position.above(),
                        null, null, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_PICKAXE));
                if (drops.size() != 1 || drops.get(0).getCount() < 3 || drops.get(0).getCount() > 5)
                    throw new IllegalStateException("The loaded cluster loot changed for " + holder.id());
                var sample = new JsonObject();
                sample.addProperty("recipe", holder.id().toString());
                sample.addProperty("cluster", BuiltInRegistries.BLOCK.getKey(stage.getBlock()).toString());
                sample.addProperty("item", BuiltInRegistries.ITEM.getKey(drops.get(0).getItem()).toString());
                sample.addProperty("count", drops.get(0).getCount());
                lootSamples.add(sample);
            }
            report.add("loaded_loot_samples", lootSamples);
            level.setBlockAndUpdate(position.above(), net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            Files.createDirectories(Path.of("planner-extraction"));
            Files.writeString(Path.of("planner-extraction/spectrum-automation.json"),
                    new GsonBuilder().setPrettyPrinting().create().toJson(report));
            System.out.println("Planner Spectrum automation measured two ink-fed growth and pickup cycles.");
            return 1;
        } finally {
            for (var place : new BlockPos[]{position.above(), planePosition, storagePosition,
                    chestPosition, cellPosition, acceptorPosition, machineNodePosition,
                    pickerNodePosition, pickerPosition, position})
                level.setBlockAndUpdate(place, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        }
    }

    private static int captureTurtleGrowth(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var position = new BlockPos(704, 160, 0);
        var turtlePosition = position.above(2);
        var inputPosition = turtlePosition.above();
        var outputPosition = turtlePosition.north();
        var pickerPosition = position.east(4);
        var machineNodePosition = position.east();
        var pickerNodePosition = pickerPosition.east();
        for (var place : new BlockPos[]{position, position.above(), turtlePosition, inputPosition,
                outputPosition, pickerPosition,
                machineNodePosition, pickerNodePosition})
            if (!level.getBlockState(place).isAir())
                throw new IllegalStateException("The turtle growth probe area is occupied.");
        var machineBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.CRYSTALLARIEUM.get();
        var pickerBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.COLOR_PICKER.get();
        var nodeBlock = de.dafuqs.spectrum.registries.SpectrumBlocks.INK_NODE.get();
        var turtleBlock = dan200.computercraft.shared.ModRegistry.Blocks.TURTLE_NORMAL.get();
        var liquid = BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse("spectrum:liquid_crystal"));
        var brown = de.dafuqs.spectrum.api.ink.color.InkColor.ofIdString("spectrum:brown").orElseThrow();
        level.setBlockAndUpdate(position, machineBlock.defaultBlockState());
        level.setBlockAndUpdate(pickerPosition, pickerBlock.defaultBlockState());
        level.setBlockAndUpdate(machineNodePosition, nodeBlock.defaultBlockState().setValue(
                de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlock.FACING,
                net.minecraft.core.Direction.EAST));
        level.setBlockAndUpdate(pickerNodePosition, nodeBlock.defaultBlockState().setValue(
                de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlock.FACING,
                net.minecraft.core.Direction.EAST));
        level.setBlockAndUpdate(turtlePosition, turtleBlock.defaultBlockState());
        level.setBlockAndUpdate(inputPosition, net.minecraft.world.level.block.Blocks.CHEST.defaultBlockState());
        level.setBlockAndUpdate(outputPosition, net.minecraft.world.level.block.Blocks.CHEST.defaultBlockState());
        try {
            var machine = (de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity)
                    level.getBlockEntity(position);
            var picker = (de.dafuqs.spectrum.blocks.ink.gen.ColorPickerBlockEntity)
                    level.getBlockEntity(pickerPosition);
            var machineNode = (de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlockEntity)
                    level.getBlockEntity(machineNodePosition);
            var pickerNode = (de.dafuqs.spectrum.blocks.pastel_network.nodes.PastelNodeBlockEntity)
                    level.getBlockEntity(pickerNodePosition);
            var turtle = (dan200.computercraft.shared.turtle.blocks.TurtleBlockEntity)
                    level.getBlockEntity(turtlePosition);
            var inputChest = (net.minecraft.world.level.block.entity.ChestBlockEntity)
                    level.getBlockEntity(inputPosition);
            var outputChest = (net.minecraft.world.level.block.entity.ChestBlockEntity)
                    level.getBlockEntity(outputPosition);
            var access = turtle.getAccess();
            var upgrade = dan200.computercraft.impl.TurtleUpgrades.instance().get(server.registryAccess(),
                    new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND_PICKAXE));
            if (upgrade == null)
                throw new IllegalStateException("The loaded turtle has no diamond-pickaxe upgrade.");
            var brain = (dan200.computercraft.shared.turtle.core.TurtleBrain) access;
            brain.setUpgrade(dan200.computercraft.api.turtle.TurtleSide.LEFT, upgrade);
            turtle.setDirection(net.minecraft.core.Direction.NORTH);
            inputChest.setItem(0, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.RAW_IRON, 2));
            brain.setSelectedSlot(0);
            machine.getFluidTank().setFluid(new net.neoforged.neoforge.fluids.FluidStack(liquid, 1000));
            var pickerHandler = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.ItemHandler.BLOCK,
                    pickerPosition, net.minecraft.core.Direction.EAST);
            if (pickerHandler == null || !pickerHandler.insertItem(1,
                    new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BROWN_DYE, 64),
                    false).isEmpty() || picker.getItem(1).getCount() != 64)
                throw new IllegalStateException("The Color Picker did not accept side-fed brown dye.");
            machineNode.connectToNearbyNodes(null);
            pickerNode.connectToNearbyNodes(null);
            if (machineNode.getServerNetwork().isEmpty() || pickerNode.getServerNetwork().isEmpty()
                    || machineNode.getServerNetwork().get() != pickerNode.getServerNetwork().get())
                throw new IllegalStateException("The turtle probe ink nodes did not connect.");
            var result = new JsonObject();
            var additiveHandler = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.ItemHandler.BLOCK,
                    position, net.minecraft.core.Direction.EAST);
            result.addProperty("machine_item_handler", additiveHandler != null);
            result.addProperty("turtle_stationary_fuel", brain.getFuelLevel());
            result.addProperty("turtle_fuel_needed", brain.isFuelNeeded());
            result.addProperty("picker_item_handler", true);
            result.addProperty("turtle_item_handler", level.getCapability(
                    net.neoforged.neoforge.capabilities.Capabilities.ItemHandler.BLOCK,
                    turtlePosition, net.minecraft.core.Direction.EAST) != null);
            var cycles = new JsonArray();
            for (int cycle = 0; cycle < 2; cycle++) {
                var suck = new dan200.computercraft.shared.turtle.core.TurtleSuckCommand(
                        dan200.computercraft.shared.turtle.core.InteractDirection.UP, 1).execute(access);
                if (!suck.isSuccess() || !brain.getInventory().getItem(0).is(net.minecraft.world.item.Items.RAW_IRON))
                    throw new IllegalStateException("The turtle did not pull a raw-iron starter from its input chest.");
                var drop = new dan200.computercraft.shared.turtle.core.TurtleDropCommand(
                        dan200.computercraft.shared.turtle.core.InteractDirection.DOWN, 1).execute(access);
                if (!drop.isSuccess())
                    throw new IllegalStateException("The turtle did not drop the starter: " + drop.getErrorMessage());
                var entities = level.getEntitiesOfClass(net.minecraft.world.entity.item.ItemEntity.class,
                        new net.minecraft.world.phys.AABB(position).inflate(2));
                var starterEntity = entities.stream().filter(entity -> entity.getItem().is(net.minecraft.world.item.Items.RAW_IRON))
                        .findFirst().orElseThrow(() -> new IllegalStateException("The turtle drop made no raw-iron entity."));
                for (int tick = 0; tick < 40 && !starterEntity.getItem().isEmpty(); tick++) starterEntity.tick();
                if (!starterEntity.getItem().isEmpty())
                    throw new IllegalStateException("The turtle starter did not land in the Crystallarieum.");
                int additiveRefill = 64 - machine.getItem(0).getCount();
                if (cycle == 0) {
                    additiveRefill = 64;
                }
                var refused = additiveHandler.insertItem(0,
                        new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_NUGGET, additiveRefill),
                        false);
                if (!refused.isEmpty() || machine.getItem(0).getCount() != 64)
                    throw new IllegalStateException("The Crystallarieum did not accept side-fed additive stock.");
                int matureTick = -1;
                var inspectCommand = new dan200.computercraft.shared.turtle.core.TurtleInspectCommand(
                        dan200.computercraft.shared.turtle.core.InteractDirection.DOWN);
                var inspectedStages = new JsonArray();
                int pickerRefill = 0;
                for (int tick = 1; tick <= 2000; tick++) {
                    if (cycle == 1 && tick == 2) {
                        pickerRefill = 64 - picker.getItem(1).getCount();
                        if (!pickerHandler.insertItem(1,
                                new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BROWN_DYE, pickerRefill),
                                false).isEmpty() || picker.getItem(1).getCount() != 64)
                            throw new IllegalStateException("The Color Picker did not accept a side-fed dye refill.");
                    }
                    if ((tick - 1) % 5 == 0) picker.tickLogic(level);
                    de.dafuqs.spectrum.blocks.pastel_network.network.ServerPastelNetworkManager.get(level).tick();
                    de.dafuqs.spectrum.blocks.ink.sink.CrystallarieumBlockEntity.serverTick(
                            level, position, level.getBlockState(position), machine);
                    var viewed = inspectCommand.execute(access);
                    if (!viewed.isSuccess())
                        throw new IllegalStateException("The turtle could not inspect the crop at tick " + tick);
                    var viewedName = (String) ((java.util.Map<?, ?>) viewed.getResults()[0]).get("name");
                    if (tick == 1 || tick == 300 || tick == 600) {
                        var stage = new JsonObject();
                        stage.addProperty("tick", tick);
                        stage.addProperty("name", viewedName);
                        inspectedStages.add(stage);
                    }
                    if (viewedName.equals("spectrum:iron_cluster")) {
                        matureTick = tick;
                        break;
                    }
                }
                if (matureTick < 0)
                    throw new IllegalStateException("The turtle crop did not mature: ink="
                            + machine.getInkStorage().getEnergy(brown) + ", additive=" + machine.getItem(0).getCount());
                var inspect = inspectCommand.execute(access);
                if (!inspect.isSuccess())
                    throw new IllegalStateException("The turtle could not inspect the mature cluster.");
                var dig = dan200.computercraft.shared.turtle.core.TurtleToolCommand.dig(
                        dan200.computercraft.shared.turtle.core.InteractDirection.DOWN, null).execute(access);
                if (!dig.isSuccess())
                    throw new IllegalStateException("The turtle could not dig the mature cluster: " + dig.getErrorMessage());
                int collected = 0;
                int outputSlot = -1;
                for (int slot = 0; slot < brain.getInventory().getContainerSize(); slot++) {
                    var stack = brain.getInventory().getItem(slot);
                    if (BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().equals("spectrum:pure_iron")) {
                        collected += stack.getCount();
                        outputSlot = slot;
                    }
                }
                if (outputSlot < 0)
                    throw new IllegalStateException("The turtle inventory contains no harvested pure iron.");
                brain.setSelectedSlot(outputSlot);
                var output = new dan200.computercraft.shared.turtle.core.TurtleDropCommand(
                        dan200.computercraft.shared.turtle.core.InteractDirection.FORWARD, collected).execute(access);
                if (!output.isSuccess())
                    throw new IllegalStateException("The turtle could not place pure iron in its output chest.");
                brain.setSelectedSlot(0);
                int outputCollected = 0;
                for (int slot = 0; slot < outputChest.getContainerSize(); slot++)
                    if (BuiltInRegistries.ITEM.getKey(outputChest.getItem(slot).getItem()).toString()
                            .equals("spectrum:pure_iron"))
                        outputCollected += outputChest.getItem(slot).getCount();
                if (outputCollected < collected)
                    throw new IllegalStateException("The output chest did not receive the harvested pure iron.");
                var sample = new JsonObject();
                sample.addProperty("cycle", cycle);
                sample.addProperty("mature_tick", matureTick);
                sample.add("inspected_stages", inspectedStages);
                sample.addProperty("collected", collected);
                sample.addProperty("output_chest_total", outputCollected);
                sample.addProperty("input_chest_remaining", inputChest.getItem(0).getCount());
                sample.addProperty("top_cleared", level.getBlockState(position.above()).isAir());
                sample.addProperty("picker_ink", picker.getInkStorage().getEnergy(brown));
                sample.addProperty("machine_ink", machine.getInkStorage().getEnergy(brown));
                sample.addProperty("additive_remaining", machine.getItem(0).getCount());
                sample.addProperty("additive_refill", additiveRefill);
                sample.addProperty("picker_dye_refill", pickerRefill);
                sample.addProperty("turtle_fuel_remaining", brain.getFuelLevel());
                cycles.add(sample);
                if (collected < 3 || collected > 5 || !level.getBlockState(position.above()).isAir())
                    throw new IllegalStateException("The turtle dig did not collect ordinary pure-iron loot.");
            }
            result.add("cycles", cycles);
            result.addProperty("fluid_remaining_mb", machine.getFluidTank().getFluidAmount());
            Files.createDirectories(Path.of("planner-extraction"));
            Files.writeString(Path.of("planner-extraction/turtle-growth.json"),
                    new GsonBuilder().setPrettyPrinting().create().toJson(result));
            System.out.println("Planner turtle harvested and replanted two ink-fed iron clusters.");
            return 1;
        } finally {
            for (var place : new BlockPos[]{position.above(), inputPosition, outputPosition, turtlePosition,
                    machineNodePosition,
                    pickerNodePosition, pickerPosition, position})
                level.setBlockAndUpdate(place, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        }
    }

    private static int captureBlasting(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var trials = com.google.gson.JsonParser.parseString(Files.readString(Path.of("planner-blasting.json"))).getAsJsonArray();
        var report = new JsonObject();
        var results = new JsonArray();
        for (int index = 0; index < trials.size(); index++) {
            var trial = trials.get(index).getAsJsonObject();
            var position = new BlockPos(480 + index * 4, 160, 0);
            if (!level.getBlockState(position).isAir()) throw new IllegalStateException("The blasting probe area is occupied.");
            level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.BLAST_FURNACE.defaultBlockState());
            var furnace = (net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity) level.getBlockEntity(position);
            try {
                var input = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(trial.get("input").getAsString()));
                var fuel = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(trial.get("fuel").getAsString()));
                furnace.setItem(0, new net.minecraft.world.item.ItemStack(input));
                furnace.setItem(1, new net.minecraft.world.item.ItemStack(fuel));
                int completion = 0;
                for (int tick = 1; tick <= 400; tick++) {
                    net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity.serverTick(
                            level, position, level.getBlockState(position), furnace);
                    if (!furnace.getItem(2).isEmpty()) { completion = tick; break; }
                }
                var output = furnace.getItem(2);
                var result = new JsonObject();
                result.addProperty("recipe", trial.get("recipe").getAsString());
                result.addProperty("input", trial.get("input").getAsString());
                result.addProperty("fuel", trial.get("fuel").getAsString());
                result.addProperty("itemstack_burn_ticks", new net.minecraft.world.item.ItemStack(fuel).getBurnTime(null));
                result.addProperty("completion_tick", completion);
                result.addProperty("output", BuiltInRegistries.ITEM.getKey(output.getItem()).toString());
                result.addProperty("output_count", output.getCount());
                result.addProperty("fuel_slot", BuiltInRegistries.ITEM.getKey(furnace.getItem(1).getItem()).toString());
                var saved = furnace.saveWithFullMetadata(server.registryAccess());
                result.addProperty("burn_time_remaining_ticks", saved.getInt("BurnTime"));
                result.addProperty("cook_time_total_ticks", saved.getInt("CookTimeTotal"));
                result.addProperty("nbt", saved.toString());
                results.add(result);
                if (completion != trial.get("cooking_ticks").getAsInt()
                        || !result.get("output").getAsString().equals(trial.get("output").getAsString())
                        || output.getCount() != trial.get("count").getAsInt()) {
                    throw new IllegalStateException("Loaded blast-furnace output or timing disagrees with " + trial.get("recipe"));
                }
                if (trial.has("fuel_remainder") && !result.get("fuel_slot").getAsString().equals(trial.get("fuel_remainder").getAsString())) {
                    throw new IllegalStateException("Loaded blast-furnace fuel remainder disagrees with " + trial.get("recipe"));
                }
            } finally {
                for (int slot = 0; slot < 3; slot++) furnace.setItem(slot, net.minecraft.world.item.ItemStack.EMPTY);
                level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            }
        }
        report.add("trials", results);
        Files.createDirectories(Path.of("planner-extraction"));
        Files.writeString(Path.of("planner-extraction/blasting.json"), new GsonBuilder().setPrettyPrinting().create().toJson(report));
        System.out.println("Planner blasting trials matched " + results.size() + " loaded recipes and fuel variants.");
        return 1;
    }

    private static int createBlastingSaveFixture(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var pureIron = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("spectrum:pure_iron"));
        var coal = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:coal"));
        var lava = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:lava_bucket"));
        var iron = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:iron_ingot"));
        var rows = new JsonArray();
        var roles = new String[]{"coal_active", "lava_active", "history_only", "fuel_unknown"};
        for (int index = 0; index < roles.length; index++) {
            var position = new BlockPos(600 + index * 4, 160, 0);
            if (!level.getBlockState(position).isAir()) throw new IllegalStateException("The blasting save fixture area is occupied.");
            level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.BLAST_FURNACE.defaultBlockState());
            var furnace = (net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity) level.getBlockEntity(position);
            var role = roles[index];
            furnace.setItem(0, new net.minecraft.world.item.ItemStack(pureIron, role.equals("history_only") ? 1 : 3));
            furnace.setItem(1, new net.minecraft.world.item.ItemStack(role.equals("lava_active") ? lava : coal,
                    role.equals("coal_active") ? 2 : 1));
            for (int tick = 0; tick < (role.equals("history_only") ? 100 : 120); tick++) {
                net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity.serverTick(
                        level, position, level.getBlockState(position), furnace);
                if (role.equals("lava_active") && tick == 99) {
                    if (!furnace.getItem(1).is(net.minecraft.world.item.Items.BUCKET))
                        throw new IllegalStateException("The lava fixture did not return its empty bucket.");
                    furnace.setItem(1, new net.minecraft.world.item.ItemStack(lava));
                }
            }
            if (!furnace.getItem(2).is(iron) || furnace.getItem(2).getCount() != 1)
                throw new IllegalStateException("A saved blast furnace did not complete its verified iron recipe.");
            var saved = furnace.saveWithFullMetadata(server.registryAccess());
            int cooking = saved.getInt("CookTime");
            int history = saved.getCompound("RecipesUsed").getInt("spectrum:blasting/pure_resources/iron");
            if (cooking != (role.equals("history_only") ? 0 : 20) || history != 1)
                throw new IllegalStateException("The saved furnace progress or recipe history changed.");
            var row = new JsonObject();
            row.addProperty("role", role);
            row.addProperty("x", position.getX());
            row.addProperty("y", position.getY());
            row.addProperty("z", position.getZ());
            row.addProperty("input_count", furnace.getItem(0).getCount());
            row.addProperty("fuel_slot", BuiltInRegistries.ITEM.getKey(furnace.getItem(1).getItem()).toString());
            row.addProperty("output_count", furnace.getItem(2).getCount());
            row.addProperty("burn_time_remaining_ticks", saved.getInt("BurnTime"));
            row.addProperty("cook_time_ticks", cooking);
            row.addProperty("recipes_used", history);
            row.addProperty("nbt", saved.toString());
            rows.add(row);
        }
        Files.createDirectories(Path.of("planner-extraction"));
        Files.writeString(Path.of("planner-extraction/blasting-save-fixture.json"),
                new GsonBuilder().setPrettyPrinting().create().toJson(rows));
        System.out.println("Planner blasting save fixture placed four furnaces.");
        return 1;
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
        if (controller instanceof net.swedz.extended_industrialization.machines.blockentity.multiblock.teslatower.TeslaTowerBlockEntity tower) {
            result.add("idle_cycle", formedTeslaCycle(tower, matcher, server));
        }
        if (bill.has("setup")) result.add("array_cycle", formedArrayCycle(controller, matcher, server, bill));
        Files.writeString(Path.of("planner-extraction", "structure-bill-check.json"), new GsonBuilder().setPrettyPrinting().create().toJson(result));
        controller.setChanged();
        System.out.println("Planner structural bill matched the loaded world structure.");
        return 1;
    }

    private static JsonObject formedArrayCycle(
            aztech.modern_industrialization.machines.multiblocks.MultiblockMachineBlockEntity controller,
            aztech.modern_industrialization.machines.multiblocks.ShapeMatcher matcher, MinecraftServer server, JsonObject bill) {
        var machine = (net.swedz.tesseract.neoforge.compat.mi.machine.blockentity.multiblock.multiplied.AbstractElectricMultipliedCraftingMultiblockBlockEntity) controller;
        var setup = bill.getAsJsonObject("setup");
        var contained = new net.minecraft.world.item.ItemStack(BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(setup.get("contained_machine").getAsString())), setup.get("contained_count").getAsInt());
        var upgradeTag = new net.minecraft.nbt.CompoundTag();
        upgradeTag.put("upgradesItemStack", new net.minecraft.world.item.ItemStack(BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(setup.getAsJsonObject("upgrade").get("id").getAsString())), setup.get("upgrade_count").getAsInt()).saveOptional(server.registryAccess()));
        for (var component : machine.components) {
            if (component instanceof net.swedz.extended_industrialization.machines.component.craft.processingarray.ProcessingArrayMachineComponent value) value.setMachines(machine, contained);
            if (component instanceof dev.wp.industrialization_overdrive.machines.components.craft.MultiProcessingArrayMachineComponent value) value.setMachines(machine, contained);
            if (component instanceof aztech.modern_industrialization.machines.components.UpgradeComponent value) value.readNbt(upgradeTag, server.registryAccess(), false);
        }
        var energy = new java.util.ArrayList<aztech.modern_industrialization.machines.components.EnergyComponent>();
        for (var hatch : matcher.getMatchedHatches()) hatch.appendEnergyInputs(energy);
        matcher.unlinkHatches();
        var levelData = (net.minecraft.world.level.storage.ServerLevelData) server.overworld().getLevelData();
        long previousTime = levelData.getGameTime(), totalEnergy = 0, lastCompletion = -1, lastEnergy = 0;
        var crafter = (MultipliedCrafterComponent) machine.getCrafterComponent();
        var samples = new JsonArray();
        try {
            for (int tick = 1; tick <= 40000; tick++) {
                levelData.setGameTime(tick);
                var inventory = machine.getMultiblockInventoryComponent();
                int itemIndex = 0, fluidIndex = 0;
                for (var flow : bill.getAsJsonArray("inputs")) {
                    String resource = flow.getAsJsonObject().get("resource").getAsString();
                    if (resource.startsWith("item:") && inventory.getItemInputs().size() > itemIndex) {
                        var slot = (aztech.modern_industrialization.inventory.ConfigurableItemStack) inventory.getItemInputs().get(itemIndex++);
                        slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(resource.substring(5)))));
                        slot.setAmount(slot.getCapacity());
                    } else if (resource.startsWith("fluid:") && inventory.getFluidInputs().size() > fluidIndex) {
                        var slot = (aztech.modern_industrialization.inventory.ConfigurableFluidStack) inventory.getFluidInputs().get(fluidIndex++);
                        slot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse(resource.substring(6)))));
                        slot.setAmount(slot.getCapacity());
                    }
                }
                for (var component : energy) component.insertEu(component.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                long before = energy.stream().mapToLong(component -> component.getEu()).sum();
                machine.tick();
                totalEnergy += before - energy.stream().mapToLong(component -> component.getEu()).sum();
                long output = inventory.getItemOutputs().stream().mapToLong(value -> value.getAmount()).sum()
                        + inventory.getFluidOutputs().stream().mapToLong(value -> value.getAmount()).sum();
                if (output == 0) continue;
                var state = new net.minecraft.nbt.CompoundTag();
                crafter.writeNbt(state, server.registryAccess());
                if (state.getInt("efficiencyTicks") >= state.getInt("maxEfficiencyTicks") && lastCompletion >= 0) {
                    var sample = new JsonObject();
                    sample.addProperty("ticks", tick - lastCompletion);
                    sample.addProperty("energy", totalEnergy - lastEnergy);
                    sample.addProperty("output_quantity", output);
                    sample.addProperty("batch", crafter.getRecipeMultiplier());
                    samples.add(sample);
                }
                lastCompletion = tick; lastEnergy = totalEnergy;
                for (var slot : inventory.getItemOutputs()) ((aztech.modern_industrialization.inventory.ConfigurableItemStack) slot).setAmount(0);
                for (var slot : inventory.getFluidOutputs()) ((aztech.modern_industrialization.inventory.ConfigurableFluidStack) slot).setAmount(0);
                if (samples.size() >= 4) break;
            }
        } finally { levelData.setGameTime(previousTime); }
        if (samples.size() < 4) throw new IllegalStateException("The formed array did not reach four steady batches.");
        var expected = bill.getAsJsonObject("expected_capacity");
        for (int index = 1; index < samples.size(); index++) {
            var sample = samples.get(index).getAsJsonObject();
            if (sample.get("ticks").getAsLong() != expected.get("ticks_per_batch").getAsLong()
                    || sample.get("energy").getAsLong() != expected.get("energy_per_batch").getAsLong())
                throw new IllegalStateException("The formed array disagrees with the planned steady batch.");
        }
        var result = new JsonObject();
        result.add("steady_batches", samples);
        result.addProperty("scope", "Real formed controller ticks with continuous direct hatch supply and cleared outputs; no cable-network throughput claim.");
        return result;
    }

    private static JsonObject formedTeslaCycle(
            net.swedz.extended_industrialization.machines.blockentity.multiblock.teslatower.TeslaTowerBlockEntity tower,
            aztech.modern_industrialization.machines.multiblocks.ShapeMatcher matcher, MinecraftServer server) {
        var energy = new java.util.ArrayList<aztech.modern_industrialization.machines.components.EnergyComponent>();
        for (var hatch : matcher.getMatchedHatches()) hatch.appendEnergyInputs(energy);
        if (energy.size() != 7) throw new IllegalStateException("The copper Tesla fixture requires seven LV hatches.");
        matcher.unlinkHatches();
        var levelData = (net.minecraft.world.level.storage.ServerLevelData) server.overworld().getLevelData();
        long previousTime = levelData.getGameTime(), consumed = 0;
        try {
            // Let the actual controller perform its own structure matching before measuring idle drain.
            for (int tick = 1; tick <= 40; tick++) {
                levelData.setGameTime(tick);
                for (var component : energy) component.insertEu(component.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                long before = energy.stream().mapToLong(component -> component.getEu()).sum();
                tower.tick();
                if (tick > 20) consumed += before - energy.stream().mapToLong(component -> component.getEu()).sum();
            }
        } finally { levelData.setGameTime(previousTime); }
        if (!tower.shapeValid.shapeValid || consumed != 1280 || tower.getCableTier() != aztech.modern_industrialization.api.energy.CableTier.LV)
            throw new IllegalStateException("The formed Tesla controller differs from its captured idle behavior.");
        var result = new JsonObject();
        result.addProperty("ticks_after_linking", 20);
        result.addProperty("energy_consumed", consumed);
        result.addProperty("hatches", energy.size());
        result.addProperty("nominal_tier_eu", tower.getCableTier().getEu());
        result.addProperty("scope", "Placed structure and controller idle ticks with directly supplied hatch energy. No receiver transfer claim.");
        return result;
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

    private static int createRotationFixture(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("modern_industrialization:steam_quarry"));
        var records = new JsonArray();
        int index = 0;
        for (var facing : net.minecraft.core.Direction.Plane.HORIZONTAL) {
            var origin = new BlockPos(256 + index++ * 32, 100, 0);
            level.setBlockAndUpdate(origin, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            level.setBlockAndUpdate(origin, block.defaultBlockState());
            var controller = (aztech.modern_industrialization.machines.multiblocks.MultiblockMachineBlockEntity) level.getBlockEntity(origin);
            controller.getOrientation().facingDirection = facing;
            var shape = controller.getActiveShape();
            int chains = 0;
            for (var entry : shape.simpleMembers.entrySet()) {
                var pos = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldPos(origin, facing, entry.getKey());
                var state = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldState(level, pos, entry.getValue().getPreviewState(), facing);
                level.setBlockAndUpdate(pos, state);
                if (state.is(net.minecraft.world.level.block.Blocks.CHAIN)) {
                    chains++;
                    if (state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.AXIS) != net.minecraft.core.Direction.Axis.Y)
                        throw new IllegalStateException("The steam quarry chain rotated away from the vertical axis.");
                }
            }
            var matcher = controller.createShapeMatcher();
            matcher.rematch(level);
            if (!matcher.isMatchSuccessful() || chains == 0)
                throw new IllegalStateException("The loaded matcher rejected the " + facing + " steam quarry or it had no chains.");
            controller.setChanged();
            var record = new JsonObject();
            record.addProperty("machine", "modern_industrialization:steam_quarry");
            record.addProperty("facing", facing.name());
            record.addProperty("facing_direction", facing.get3DDataValue());
            record.addProperty("x", origin.getX());
            record.addProperty("y", origin.getY());
            record.addProperty("z", origin.getZ());
            record.addProperty("vertical_chains", chains);
            record.addProperty("loaded_matcher_accepted", true);
            records.add(record);
        }
        Files.writeString(Path.of("planner-extraction", "rotation-fixture.json"), new GsonBuilder().setPrettyPrinting().create().toJson(records));
        System.out.println("Planner rotation fixtures matched all four loaded steam quarries.");
        return 1;
    }

    private static int captureSolarPanels(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var rows = new JsonArray();
        level.setWeatherParameters(100000, 0, false, false);
        String[] tiers = {"lv", "mv", "hv"};
        for (int index = 0; index < tiers.length; index++) {
            String tier = tiers[index];
            var pos = new BlockPos(400 + index * 8, 250, 0);
            var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("extended_industrialization:" + tier + "_solar_panel"));
            var cell = BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("extended_industrialization:" + tier + "_photovoltaic_cell"));
            level.setBlockAndUpdate(pos, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            level.setBlockAndUpdate(pos, block.defaultBlockState());
            var panel = (net.swedz.extended_industrialization.machines.blockentity.SolarPanelMachineBlockEntity) level.getBlockEntity(pos);
            var cellSlot = panel.getInventory().getItemStacks().getFirst();
            cellSlot.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.item.ItemVariant.of(cell));
            cellSlot.setAmount(1);
            var energy = (aztech.modern_industrialization.machines.components.EnergyComponent) panel.getEnergyComponent();
            var record = new JsonObject();
            record.addProperty("machine", "extended_industrialization:" + tier + "_solar_panel");
            record.addProperty("cell", "extended_industrialization:" + tier + "_photovoltaic_cell");
            record.addProperty("can_see_sky", level.canSeeSky(pos.above()));
            var samples = new JsonArray();
            for (int time : new int[] {0, 1500, 6000, 10500, 12000, 12001}) {
                level.setDayTime(time);
                long before = energy.getEu();
                panel.tick();
                long made = energy.getEu() - before;
                energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                var sample = new JsonObject();
                sample.addProperty("time", time);
                sample.addProperty("generated_eu", made);
                sample.addProperty("cell_ticks", cellSlot.toStack().getOrDefault(net.swedz.extended_industrialization.EIComponents.SOLAR_TICKS, 0));
                samples.add(sample);
            }
            record.add("clear_samples", samples);
            var water = panel.getInventory().getFluidStacks().getFirst();
            var distilled = BuiltInRegistries.FLUID.get(net.minecraft.resources.ResourceLocation.parse("extended_industrialization:distilled_water"));
            water.setKey(aztech.modern_industrialization.thirdparty.fabrictransfer.api.fluid.FluidVariant.of(distilled));
            water.setAmount(10);
            level.setDayTime(6000);
            panel.tick();
            record.addProperty("distilled_water_generated_eu", energy.getEu());
            record.addProperty("distilled_water_remaining_mb", water.getAmount());
            record.addProperty("distilled_water_cell_ticks", cellSlot.toStack().getOrDefault(net.swedz.extended_industrialization.EIComponents.SOLAR_TICKS, 0));
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            level.setWeatherParameters(0, 100000, true, false);
            level.setRainLevel(1.0f);
            panel.tick();
            record.addProperty("rain_generated_eu", energy.getEu());
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            level.setWeatherParameters(100000, 0, false, false);
            level.setRainLevel(0.0f);
            level.setBlockAndUpdate(pos.above(2), net.minecraft.world.level.block.Blocks.STONE.defaultBlockState());
            if (!record.get("can_see_sky").getAsBoolean()) throw new IllegalStateException("The solar fixture needs open sky.");
            rows.add(record);
        }
        Files.writeString(Path.of("planner-extraction", "solar-panels.json"), new GsonBuilder().setPrettyPrinting().create().toJson(rows));
        System.out.println("Planner solar panel samples captured from three loaded machines.");
        return 1;
    }

    private static int checkSolarRoofs(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var path = Path.of("planner-extraction", "solar-panels.json");
        var rows = com.google.gson.JsonParser.parseString(Files.readString(path)).getAsJsonArray();
        level.setWeatherParameters(100000, 0, false, false);
        level.setRainLevel(0.0f);
        level.setDayTime(6000);
        for (int index = 0; index < rows.size(); index++) {
            var pos = new BlockPos(400 + index * 8, 250, 0);
            var panel = (net.swedz.extended_industrialization.machines.blockentity.SolarPanelMachineBlockEntity) level.getBlockEntity(pos);
            var energy = (aztech.modern_industrialization.machines.components.EnergyComponent) panel.getEnergyComponent();
            var record = rows.get(index).getAsJsonObject();
            record.addProperty("blocked_stone_present", level.getBlockState(pos.above(2)).is(net.minecraft.world.level.block.Blocks.STONE));
            record.addProperty("blocked_can_see_sky", level.canSeeSky(pos.above()));
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            panel.tick();
            record.addProperty("blocked_generated_eu", energy.getEu());
            level.setBlockAndUpdate(pos.above(2), net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        }
        Files.writeString(path, new GsonBuilder().setPrettyPrinting().create().toJson(rows));
        System.out.println("Planner solar roof samples captured from three loaded machines.");
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

    private static JsonObject certusFarm(MinecraftServer server, boolean silkTouch) throws Exception {
        var level = server.overworld();
        var origin = new BlockPos(64, 160, 0);
        for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) for (int z = -3; z <= 3; z++)
            level.setBlockAndUpdate(origin.offset(x, y, z), net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        level.setBlockAndUpdate(origin, appeng.core.definitions.AEBlocks.FLAWLESS_BUDDING_QUARTZ.block().defaultBlockState());
        var positions = new java.util.LinkedHashSet<BlockPos>();
        for (int x = -2; x <= 2; x++) for (int z = -2; z <= 2; z++)
            if (Math.abs(x) == 2 || Math.abs(z) == 2) positions.add(origin.offset(x, 0, z));
        for (int sign : new int[]{-1, 1}) {
            positions.add(origin.offset(2, sign, 0));
            positions.add(origin.offset(2, 2 * sign, 0));
            positions.add(origin.offset(1, 2 * sign, 0));
            positions.add(origin.offset(0, 2 * sign, 0));
        }
        var cables = new java.util.ArrayList<appeng.blockentity.networking.CableBusBlockEntity>();
        var planes = new java.util.ArrayList<appeng.parts.automation.AnnihilationPlanePart>();
        appeng.parts.storagebus.StorageBusPart storage = null;
        for (var pos : positions) {
            level.setBlockAndUpdate(pos, appeng.core.definitions.AEBlocks.CABLE_BUS.block().defaultBlockState());
            var cable = (appeng.blockentity.networking.CableBusBlockEntity) level.getBlockEntity(pos);
            cable.addPart(appeng.core.definitions.AEParts.GLASS_CABLE.item(appeng.api.util.AEColor.TRANSPARENT), null, null);
            for (var side : net.minecraft.core.Direction.values()) {
                if (side != net.minecraft.core.Direction.SOUTH && pos.equals(origin.relative(side, 2))) {
                    var plane = cable.addPart(appeng.core.definitions.AEParts.ANNIHILATION_PLANE.get(), side.getOpposite(), null);
                    if (silkTouch) {
                        var enchantments = new net.minecraft.world.item.enchantment.ItemEnchantments.Mutable(net.minecraft.world.item.enchantment.ItemEnchantments.EMPTY);
                        enchantments.set(server.registryAccess().lookupOrThrow(net.minecraft.core.registries.Registries.ENCHANTMENT)
                                .getOrThrow(net.minecraft.world.item.enchantment.Enchantments.SILK_TOUCH), 1);
                        plane.importSettings(appeng.util.SettingsFrom.DISMANTLE_ITEM, net.minecraft.core.component.DataComponentMap.builder()
                                .set(net.minecraft.core.component.DataComponents.ENCHANTMENTS, enchantments.toImmutable()).build(), null);
                    }
                    planes.add(plane);
                }
            }
            if (pos.equals(origin.south(2))) {
                storage = cable.addPart(appeng.core.definitions.AEParts.STORAGE_BUS.get(), net.minecraft.core.Direction.SOUTH, null);
                storage.getConfig().setStack(0, new appeng.api.stacks.GenericStack(appeng.api.stacks.AEItemKey.of(silkTouch
                        ? appeng.core.definitions.AEBlocks.QUARTZ_CLUSTER.asItem() : appeng.core.definitions.AEItems.CERTUS_QUARTZ_CRYSTAL.asItem()), 1));
            }
            cables.add(cable);
        }
        level.setBlockAndUpdate(origin.south(3), net.minecraft.world.level.block.Blocks.CHEST.defaultBlockState());
        var chest = (net.minecraft.world.level.block.entity.ChestBlockEntity) level.getBlockEntity(origin.south(3));
        if (!appeng.util.Platform.areBlockEntitiesTicking(level, origin.south(3)))
            throw new IllegalStateException("Force-load the certus fixture chunks before running the probe.");
        level.setBlockAndUpdate(origin.south(), appeng.core.definitions.AEBlocks.GROWTH_ACCELERATOR.block().defaultBlockState());
        var accelerator = (appeng.blockentity.misc.GrowthAcceleratorBlockEntity) level.getBlockEntity(origin.south());
        var cellPos = origin.offset(1, 1, 2);
        level.setBlockAndUpdate(cellPos, appeng.core.definitions.AEBlocks.ENERGY_CELL.block().defaultBlockState());
        var cell = (appeng.blockentity.networking.EnergyCellBlockEntity) level.getBlockEntity(cellPos);
        level.setBlockAndUpdate(cellPos.above(), appeng.core.definitions.AEBlocks.ENERGY_ACCEPTOR.block().defaultBlockState());
        var acceptor = (appeng.blockentity.networking.EnergyAcceptorBlockEntity) level.getBlockEntity(cellPos.above());
        for (var cable : cables) cable.onReady();
        accelerator.onReady();
        cell.onReady();
        acceptor.onReady();
        var grid = (appeng.me.Grid) cell.getMainNode().getGrid();
        if (grid != accelerator.getMainNode().getGrid() || planes.stream().anyMatch(plane -> plane.getMainNode().getGrid() != grid))
            throw new IllegalStateException("The placed certus farm is not one connected network.");
        int ticks = 600000;
        long output = 0;
        double energy = 0;
        for (int t = -200; t < ticks; t++) {
            acceptor.injectExternalPower(appeng.api.config.PowerUnit.FE, 403200, appeng.api.config.Actionable.MODULATE);
            double before = cell.getAECurrentPower() + accelerator.getInternalCurrentPower();
            grid.onServerStartTick();
            grid.onLevelStartTick(level);
            grid.onLevelEndTick(level);
            grid.onServerEndTick();
            if (t >= 0) energy += before - cell.getAECurrentPower() - accelerator.getInternalCurrentPower();
            for (int slot = 0; slot < chest.getContainerSize(); slot++) {
                if (t >= 0) output += chest.getItem(slot).getCount();
                chest.setItem(slot, net.minecraft.world.item.ItemStack.EMPTY);
            }
        }
        var report = new JsonObject();
        report.addProperty("ticks", ticks);
        report.addProperty("output_items", output);
        report.addProperty("silk_touch", silkTouch);
        report.addProperty("energy_ae", energy);
        report.addProperty("network_idle_ae_per_tick", grid.getEnergyService().getIdlePowerUsage());
        report.addProperty("accelerator_remaining_local_ae", accelerator.getInternalCurrentPower());
        report.addProperty("cables", cables.size());
        report.addProperty("planes", planes.size());
        report.addProperty("nodes", grid.size());
        report.addProperty("accelerator_powered", accelerator.isPowered());
        report.addProperty("growth_tag", level.getBlockState(origin).is(appeng.api.ids.AETags.GROWTH_ACCELERATABLE));
        var states = new JsonArray();
        for (var side : net.minecraft.core.Direction.values()) {
            var state = new JsonObject();
            state.addProperty("side", side.toString());
            state.addProperty("block", BuiltInRegistries.BLOCK.getKey(level.getBlockState(origin.relative(side)).getBlock()).toString());
            states.add(state);
        }
        report.add("final_neighbors", states);
        report.addProperty("active_planes", planes.stream().filter(plane -> plane.getMainNode().isActive()).count());
        report.addProperty("scope", "Placed cable network, five filtered planes, chest storage bus, one accelerator, energy cell, and FE-fed energy acceptor. Real grid services run for 600000 ticks; natural random ticks and player distance are excluded. Output chest is emptied each tick.");
        return report;
    }

    private static JsonObject certusGrowth(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var origin = new BlockPos(512, 100, 0);
        var target = origin.below();
        var previous = level.getBlockState(origin);
        var previousTarget = level.getBlockState(target);
        var result = new JsonObject();
        result.addProperty("accelerator_interval_ticks", appeng.core.AEConfig.instance().getGrowthAcceleratorSpeed());
        result.addProperty("growth_chance_denominator", appeng.decorative.solid.BuddingCertusQuartzBlock.GROWTH_CHANCE);
        result.addProperty("decay_chance_denominator", appeng.decorative.solid.BuddingCertusQuartzBlock.DECAY_CHANCE);
        var accelerator = (appeng.blockentity.misc.GrowthAcceleratorBlockEntity) appeng.core.definitions.AEBlocks.GROWTH_ACCELERATOR.block()
                .newBlockEntity(origin, appeng.core.definitions.AEBlocks.GROWTH_ACCELERATOR.block().defaultBlockState());
        accelerator.setLevel(level);
        accelerator.injectExternalPower(appeng.api.config.PowerUnit.AE, 1600, appeng.api.config.Actionable.MODULATE);
        double before = accelerator.getInternalCurrentPower();
        var tick = accelerator.getClass().getDeclaredMethod("onTick", int.class);
        tick.setAccessible(true);
        tick.invoke(accelerator, appeng.core.AEConfig.instance().getGrowthAcceleratorSpeed());
        result.addProperty("accelerator_local_ae_per_call", before - accelerator.getInternalCurrentPower());
        result.addProperty("accelerator_network_idle_ae_per_tick", ((appeng.me.ManagedGridNode) accelerator.getMainNode()).getIdlePowerUsage());
        var insertion = new JsonArray();
        for (int amount : new int[]{1, 4}) {
            double[] consumed = {0};
            var storage = new appeng.api.storage.MEStorage() {
                @Override public long insert(appeng.api.stacks.AEKey key, long count, appeng.api.config.Actionable action,
                        appeng.api.networking.security.IActionSource source) { return count; }
                @Override public net.minecraft.network.chat.Component getDescription() { return net.minecraft.network.chat.Component.literal("Probe storage"); }
            };
            long inserted = appeng.api.storage.StorageHelper.poweredInsert((energy, action, multiplier) -> {
                if (action == appeng.api.config.Actionable.MODULATE) consumed[0] += energy * multiplier.multiplier;
                return energy;
            }, storage, appeng.api.stacks.AEItemKey.of(appeng.core.definitions.AEItems.CERTUS_QUARTZ_CRYSTAL.asItem()), amount,
                    appeng.api.networking.security.IActionSource.empty());
            var entry = new JsonObject();
            entry.addProperty("items", inserted);
            entry.addProperty("energy_ae", consumed[0]);
            insertion.add(entry);
        }
        result.add("storage_insertion", insertion);
        var transitions = new JsonArray();
        var harvesting = new JsonArray();
        String[] parents = {"flawless_budding_quartz", "flawed_budding_quartz", "chipped_budding_quartz", "damaged_budding_quartz"};
        String[] stages = {"minecraft:air", "ae2:small_quartz_bud", "ae2:medium_quartz_bud", "ae2:large_quartz_bud", "ae2:quartz_cluster"};
        var registries = server.registryAccess();
        var silk = new net.minecraft.world.item.enchantment.ItemEnchantments.Mutable(net.minecraft.world.item.enchantment.ItemEnchantments.EMPTY);
        silk.set(registries.lookupOrThrow(net.minecraft.core.registries.Registries.ENCHANTMENT).getOrThrow(net.minecraft.world.item.enchantment.Enchantments.SILK_TOUCH), 1);
        try {
            for (String parent : parents) for (int stage = 0; stage < 4; stage++) {
                var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("ae2:" + parent));
                level.setBlockAndUpdate(origin, block.defaultBlockState());
                var child = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(stages[stage])).defaultBlockState();
                if (stage > 0) child = child.setValue(net.minecraft.world.level.block.AmethystClusterBlock.FACING, net.minecraft.core.Direction.DOWN);
                level.setBlockAndUpdate(target, child);
                var random = (net.minecraft.util.RandomSource) java.lang.reflect.Proxy.newProxyInstance(PlannerProbe.class.getClassLoader(),
                        new Class<?>[]{net.minecraft.util.RandomSource.class}, (proxy, method, args) -> {
                            if (method.getName().equals("nextInt") && args != null && args.length == 1) return 0;
                            return method.invoke(net.minecraft.util.RandomSource.create(1), args);
                        });
                ((appeng.decorative.solid.BuddingCertusQuartzBlock) block).randomTick(block.defaultBlockState(), level, origin, random);
                var entry = new JsonObject();
                entry.addProperty("parent", "ae2:" + parent);
                entry.addProperty("stage", stage);
                entry.addProperty("grown", BuiltInRegistries.BLOCK.getKey(level.getBlockState(target).getBlock()).toString());
                entry.addProperty("decayed_parent", BuiltInRegistries.BLOCK.getKey(level.getBlockState(origin).getBlock()).toString());
                transitions.add(entry);
            }
            for (boolean enchanted : new boolean[]{false, true}) for (int stage = 1; stage <= 4; stage++) {
                level.setBlockAndUpdate(origin, appeng.core.definitions.AEBlocks.FLAWLESS_BUDDING_QUARTZ.block().defaultBlockState());
                var child = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(stages[stage])).defaultBlockState()
                        .setValue(net.minecraft.world.level.block.AmethystClusterBlock.FACING, net.minecraft.core.Direction.DOWN);
                level.setBlockAndUpdate(target, child);
                var strategy = new appeng.parts.automation.ItemPickupStrategy(level, target, net.minecraft.core.Direction.DOWN, null,
                        enchanted ? silk.toImmutable() : net.minecraft.world.item.enchantment.ItemEnchantments.EMPTY, null);
                var accepted = new JsonArray();
                double[] power = {0};
                var outcome = strategy.tryPickup((amount, action, multiplier) -> {
                    if (action == appeng.api.config.Actionable.MODULATE) power[0] += amount * multiplier.multiplier;
                    return amount;
                }, (what, amount, action) -> {
                    if (!(what instanceof appeng.api.stacks.AEItemKey item)) return 0;
                    String id = BuiltInRegistries.ITEM.getKey(item.getItem()).toString();
                    if (!id.equals(enchanted ? "ae2:quartz_cluster" : "ae2:certus_quartz_crystal")) return 0;
                    if (action == appeng.api.config.Actionable.MODULATE) {
                        var entry = new JsonObject(); entry.addProperty("item", id); entry.addProperty("amount", amount); accepted.add(entry);
                    }
                    return amount;
                });
                var entry = new JsonObject();
                entry.addProperty("silk_touch", enchanted);
                entry.addProperty("stage", stage);
                entry.addProperty("outcome", outcome.toString());
                entry.addProperty("energy_ae", power[0]);
                entry.addProperty("block_removed", level.getBlockState(target).isAir());
                entry.add("accepted", accepted);
                harvesting.add(entry);
            }
        } finally {
            level.setBlockAndUpdate(origin, previous);
            level.setBlockAndUpdate(target, previousTarget);
        }
        result.add("forced_success_and_decay_transitions", transitions);
        result.add("filtered_plane_harvesting", harvesting);
        result.addProperty("scope", "Loaded growth branches with controlled random choices and actual plane pickup strategies. This does not measure a complete farm's stochastic throughput or network power.");
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

    private static JsonObject projectedState(net.minecraft.world.level.block.state.BlockState state,
            java.util.List<net.minecraft.world.level.block.state.properties.Property<?>> properties) {
        var result = new JsonObject();
        for (var property : properties) result.addProperty(property.getName(), stateValue(property, state.getValues().get(property)));
        return result;
    }

    private static JsonArray compactStates(net.minecraft.world.level.block.Block block,
            java.util.List<net.minecraft.world.level.block.state.BlockState> matching) {
        var possible = block.getStateDefinition().getPossibleStates();
        if (matching.size() == possible.size()) {
            var record = new JsonObject();
            record.addProperty("Name", BuiltInRegistries.BLOCK.getKey(block).toString());
            record.add("Properties", new JsonObject());
            var all = new JsonArray();
            all.add(record);
            return all;
        }
        var accepted = new java.util.HashSet<>(matching);
        var properties = new java.util.ArrayList<net.minecraft.world.level.block.state.properties.Property<?>>(block.getStateDefinition().getProperties());
        // A property can disappear only if every loaded state in each remaining partition agrees.
        for (var candidate : new java.util.ArrayList<>(properties)) {
            var reduced = new java.util.ArrayList<>(properties);
            reduced.remove(candidate);
            var partitions = new java.util.HashMap<String, Boolean>();
            boolean independent = true;
            for (var state : possible) {
                String key = projectedState(state, reduced).toString();
                boolean matches = accepted.contains(state);
                Boolean previous = partitions.putIfAbsent(key, matches);
                if (previous != null && previous.booleanValue() != matches) { independent = false; break; }
            }
            if (independent) properties = reduced;
        }
        var projections = new java.util.LinkedHashMap<String, JsonObject>();
        for (var state : matching) {
            var projected = projectedState(state, properties);
            projections.putIfAbsent(projected.toString(), projected);
        }
        for (var state : possible) {
            if (projections.containsKey(projectedState(state, properties).toString()) != accepted.contains(state)) {
                throw new IllegalStateException("State projection changed a loaded predicate: " + state);
            }
        }
        var result = new JsonArray();
        for (var projected : projections.values()) {
            var record = new JsonObject();
            record.addProperty("Name", BuiltInRegistries.BLOCK.getKey(block).toString());
            record.add("Properties", projected);
            result.add(record);
        }
        return result;
    }

    private static int memberRule(aztech.modern_industrialization.machines.multiblocks.SimpleMember member, MinecraftServer server) {
        return memberRules.computeIfAbsent(member, value -> {
            var rule = new JsonObject();
            String name = value.getClass().getName();
            rule.addProperty("source_class", name);
            // These MI factories and Tesseract's typed Predicate<BlockState> ignore block entities.
            boolean stateOnly = name.matches("aztech\\.modern_industrialization\\.machines\\.multiblocks\\.SimpleMember\\$[1-4]")
                    || name.equals("net.swedz.tesseract.neoforge.compat.mi.machine.multiblock.member.PredicateSimpleMember");
            rule.addProperty("state_only_verified", stateOnly);
            if (stateOnly) {
                var states = new JsonArray();
                var acceptedStates = new java.util.ArrayList<net.minecraft.world.level.block.state.BlockState>();
                boolean directional = false;
                long matchingCount = 0, checkedCount = 0;
                for (var block : BuiltInRegistries.BLOCK) {
                    var possible = block.getStateDefinition().getPossibleStates();
                    var matching = possible.stream().filter(state -> value.matchesState(state, null)).toList();
                    if (matching.isEmpty()) continue;
                    acceptedStates.addAll(matching);
                    matchingCount += matching.size();
                    checkedCount += possible.size();
                    var projected = compactStates(block, matching);
                    states.addAll(projected);
                    for (var entry : projected) {
                        var properties = entry.getAsJsonObject().getAsJsonObject("Properties");
                        if (properties.keySet().stream().anyMatch(key -> java.util.Set.of("facing", "axis", "rotation", "north", "east", "south", "west", "shape").contains(key)))
                            directional = true;
                    }
                }
                rule.add("matching_states", states);
                rule.addProperty("matching_state_count", matchingCount);
                rule.addProperty("projection_checked_state_count", checkedCount);
                rule.addProperty("projection_verified", true);
                if (directional) {
                    var worldStates = new JsonObject();
                    var level = server.overworld();
                    var first = new BlockPos(0, 100, 0);
                    var second = new BlockPos(127, 100, -43);
                    boolean reliable = true;
                    for (var facing : net.minecraft.core.Direction.Plane.HORIZONTAL) {
                        var byBlock = new java.util.TreeMap<String, java.util.LinkedHashSet<net.minecraft.world.level.block.state.BlockState>>();
                        for (var template : acceptedStates) {
                            var world = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldState(level, first, template, facing);
                            var repeated = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toWorldState(level, second, template, facing);
                            var restored = aztech.modern_industrialization.machines.multiblocks.ShapeMatcher.toTemplateState(level, first, world, facing);
                            if (!world.equals(repeated) || !template.equals(restored)) { reliable = false; break; }
                            byBlock.computeIfAbsent(BuiltInRegistries.BLOCK.getKey(world.getBlock()).toString(), key -> new java.util.LinkedHashSet<>()).add(world);
                        }
                        if (!reliable) break;
                        var projected = new JsonArray();
                        for (var entry : byBlock.entrySet()) {
                            var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(entry.getKey()));
                            projected.addAll(compactStates(block, java.util.List.copyOf(entry.getValue())));
                        }
                        worldStates.add(Integer.toString(facing.get3DDataValue()), projected);
                    }
                    if (reliable) {
                        rule.add("matching_world_states", worldStates);
                        rule.addProperty("rotation_verified", true);
                    } else rule.addProperty("rotation_unverified_reason", "The loaded block rotation changed with position or did not reverse to its template state.");
                }
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
                        cell.addProperty("member_rule", memberRule(entry.getValue(), server));
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

    private static JsonObject storageUnit(aztech.modern_industrialization.machines.blockentities.StorageMachineBlockEntity storage,
            MinecraftServer server) throws Exception {
        var tier = storage.getCableTier();
        var energy = storage.getEnergyComponent();
        long original = energy.getEu();
        var parent = aztech.modern_industrialization.machines.blockentities.AbstractStorageMachineBlockEntity.class;
        var inputField = parent.getDeclaredField("insertable");
        var outputField = parent.getDeclaredField("extractable");
        inputField.setAccessible(true);
        outputField.setAccessible(true);
        var input = (aztech.modern_industrialization.api.energy.MIEnergyStorage) inputField.get(storage);
        var output = (aztech.modern_industrialization.api.energy.MIEnergyStorage) outputField.get(storage);
        var peerEnergy = new aztech.modern_industrialization.machines.components.EnergyComponent(storage,
                tier.getMaxTransfer() * 100);
        var peerOutput = peerEnergy.buildExtractable(value -> value == tier);
        var peerInput = peerEnergy.buildInsertable(value -> value == tier);
        var result = new JsonObject();
        result.addProperty("scope", "Loaded storage adapters on a one-node cable network. A placed cable topology is not established.");
        result.addProperty("capacity_eu", energy.getCapacity());
        result.addProperty("nominal_tier_eu", tier.getEu());
        result.addProperty("cable_limit_eu_per_tick", tier.getMaxTransfer());
        try {
            for (boolean charging : new boolean[]{true, false}) {
                var nodes = new java.util.ArrayList<aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode>();
                var node = new aztech.modern_industrialization.pipes.electricity.ElectricityNetworkNode() {
                    @Override public void appendAttributes(net.minecraft.server.level.ServerLevel world, BlockPos pos,
                            aztech.modern_industrialization.api.energy.CableTier cableTier,
                            java.util.List<aztech.modern_industrialization.api.energy.MIEnergyStorage> storages) {
                        if (charging) { storages.add(peerOutput); storages.add(input); }
                        else { storages.add(output); storages.add(peerInput); }
                    }
                };
                nodes.add(new aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode(BlockPos.ZERO, node));
                var network = new aztech.modern_industrialization.pipes.electricity.ElectricityNetwork(0, null, tier) {
                    @Override public java.util.Collection<aztech.modern_industrialization.pipes.api.PipeNetwork.PosNode> iterateTickingNodes() { return nodes; }
                };
                long moved = 0;
                for (int tick = 0; tick < 20; tick++) {
                    energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    peerEnergy.consumeEu(peerEnergy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
                    if (charging) peerEnergy.insertEu(peerEnergy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                    else energy.insertEu(energy.getCapacity(), aztech.modern_industrialization.util.Simulation.ACT);
                    network.tick(server.overworld());
                    long transferred = charging ? energy.getEu() : peerEnergy.getEu();
                    if (transferred != tier.getMaxTransfer()) throw new IllegalStateException("Storage transfer differs from the loaded cable limit.");
                    moved += transferred;
                }
                result.addProperty(charging ? "charge_eu_over_20_ticks" : "discharge_eu_over_20_ticks", moved);
            }
        } finally {
            energy.consumeEu(energy.getEu(), aztech.modern_industrialization.util.Simulation.ACT);
            energy.insertEu(original, aztech.modern_industrialization.util.Simulation.ACT);
        }
        return result;
    }

    private static int createStorageFixture(MinecraftServer server) throws Exception {
        var level = server.overworld();
        var rows = new JsonArray();
        var tiers = new String[]{"lv", "mv", "hv", "ev", "superconductor"};
        for (int index = 0; index < tiers.length; index++) {
            var id = "modern_industrialization:" + tiers[index] + "_storage_unit";
            var block = BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse(id));
            var position = new BlockPos(400 + index * 4, 160, 0);
            level.setBlockAndUpdate(position, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            level.setBlockAndUpdate(position, block.defaultBlockState());
            var storage = (aztech.modern_industrialization.machines.blockentities.StorageMachineBlockEntity)
                    level.getBlockEntity(position);
            if (storage == null) throw new IllegalStateException("A placed storage unit had no block entity: " + id);
            var energy = storage.getEnergyComponent();
            long filled = energy.getCapacity() / 3;
            energy.insertEu(filled, aztech.modern_industrialization.util.Simulation.ACT);
            if (energy.getEu() != filled) throw new IllegalStateException("The placed storage unit did not accept its initial charge.");
            var row = new JsonObject();
            row.addProperty("machine", id);
            row.addProperty("x", position.getX());
            row.addProperty("y", position.getY());
            row.addProperty("z", position.getZ());
            row.addProperty("stored_eu", filled);
            rows.add(row);
        }
        Files.createDirectories(Path.of("planner-extraction"));
        Files.writeString(Path.of("planner-extraction/storage-fixture.json"), new GsonBuilder().setPrettyPrinting().create().toJson(rows));
        System.out.println("Planner storage fixture placed five charged MI storage units.");
        return 1;
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
                if (entity instanceof aztech.modern_industrialization.machines.blockentities.StorageMachineBlockEntity storage)
                    record.add("storage_probe", storageUnit(storage, server));
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
        result.add("certus_growth", certusGrowth(server));
        if (Boolean.getBoolean("planner.certusFarm")) {
            var certusFarms = new JsonArray();
            certusFarms.add(certusFarm(server, false));
            certusFarms.add(certusFarm(server, true));
            result.add("certus_farms", certusFarms);
        }
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
