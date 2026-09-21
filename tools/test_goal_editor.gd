extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(50).timeout.connect(func() -> void: push_error("Goal editing timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	workspace.computation.failed.connect(func(message: String) -> void: push_error(message); quit(1))
	await process_frame
	workspace.computation.cancel()
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json"))))
	workspace._request = {"goals": []}
	var dialog := workspace.get_node("%GoalEditor") as PlannerGoalEditor
	dialog.open_goal(workspace._recipes.assemble, workspace._dataset, workspace._request)
	dialog.get_node("%GoalKind").select(1)
	dialog.get_node("%GoalMachines").value = 3
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	assert(dialog._preview.configuration.operations_per_second == 1)
	if DisplayServer.get_name() != "headless":
		OS.low_processor_usage_mode = false
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/goal-editor.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.goals[0].kind == "capacity")
	assert(workspace._request.goals[0].machines == 3)
	assert(workspace._last_result.targets[0].rate == 3)
	var positions: Dictionary = workspace._positions.duplicate(true)
	dialog.open_goal(workspace._recipes.assemble, workspace._dataset, workspace._request)
	dialog.get_node("%GoalKind").select(2)
	dialog.get_node("%GoalRate").value = 2
	dialog.get_node("%GoalQuantity").text = "1200"
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.goals.size() == 1)
	assert(workspace._last_result.targets[0].steady_production_seconds == 600)
	assert(workspace._positions == positions)
	dialog.open_goal(workspace._recipes.assemble, workspace._dataset, workspace._request)
	dialog.get_node("%GoalQuantity").text = "1000000000000000000000000000001"
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	assert("Approximately" in dialog.get_node("%GoalPreview").text)
	if DisplayServer.get_name() != "headless":
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/large-quantity.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.goals[0].quantity == "1000000000000000000000000000001")
	assert(workspace._last_result.targets[0].completion_ticks_ceil == "10000000000000000000000000000010")
	assert(PlannerDatasetValidation.check_plan(workspace._snapshot()).is_empty())
	workspace._undo_action()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.goals[0].quantity == "1200")
	workspace._undo_action()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.goals[0].kind == "capacity")
	assert(workspace._last_result.targets[0].rate == 3)
	print("Goal editing preserved machine capacity, finite production time, positions, and undo.")
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--catalog="):
			await _check_catalog(workspace, argument.trim_prefix("--catalog="))
	quit()


func _check_catalog(workspace: PlannerWorkspace, path: String) -> void:
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string(path))))
	assert(workspace.recipes_list.item_count == workspace.RECIPE_PAGE_SIZE)
	workspace.get_node("%NextRecipes").pressed.emit()
	assert(workspace.recipes_list.get_item_metadata(0) == workspace._dataset.recipes[workspace.RECIPE_PAGE_SIZE].id)
	workspace._filter_recipes("copper_cluster")
	assert(workspace._recipe_page == 0 && workspace.recipes_list.item_count > 0)
	assert("copper_cluster" in workspace.recipes_list.get_item_metadata(0))
	workspace._filter_recipes("")
	workspace._request = {"goals": [], "available_machines": ["modern_industrialization:electric_macerator"],
		"external": [{"resource": "item:spectrum:copper_cluster"}, {"resource": "energy:eu"}]}
	var recipe: Dictionary = {}
	for candidate: Dictionary in workspace._dataset.recipes:
		if candidate.get("source_id") == "statech:modern_industrialization/macerator/copper_dust_from_copper_cluster":
			recipe = candidate
	var dialog := workspace.get_node("%GoalEditor") as PlannerGoalEditor
	dialog.open_goal(recipe, workspace._dataset, workspace._request)
	var machines: OptionButton = dialog.get_node("%GoalMachine")
	for index: int in machines.item_count:
		if machines.get_item_metadata(index).id == "modern_industrialization:electric_macerator":
			machines.select(index)
			dialog._machine_changed(index)
	var upgrades: OptionButton = dialog.get_node("%GoalUpgrade")
	for index: int in upgrades.item_count:
		if upgrades.get_item_metadata(index).get("id") == "modern_industrialization:advanced_upgrade":
			upgrades.select(index)
	dialog.get_node("%GoalKind").select(1)
	dialog.get_node("%GoalMachines").value = 2
	dialog.get_node("%GoalUpgradeCount").value = 8
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	assert(is_equal_approx(dialog._preview.outputs[0].rate_per_machine, 40))
	if DisplayServer.get_name() != "headless":
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/real-goal-editor.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._last_result.lines.size() == 1)
	assert(workspace._last_result.targets[0].rate == 80)
	var recipe_node := workspace._nodes.values()[0] as PlannerRecipeNode
	assert(recipe_node.summary.text == "2 × Electric Macerator")
	assert(recipe_node.loadout.text.contains("8 × Advanced Upgrade per machine"))
	assert(workspace.inspector.text.contains("ticks per batch"))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/real-node-inspector.png")
	dialog.open_goal(recipe, workspace._dataset, workspace._request)
	assert(dialog.get_node("%GoalUpgradeCount").value == 8)
	assert(dialog.get_node("%GoalMachines").value == 2)
	dialog.hide()
	print("The real catalog goal retains two macerators, eight advanced upgrades each, and 80 copper dust per second.")
	workspace._request.available_machines.append("extended_industrialization:processing_array")
	dialog.open_goal(recipe, workspace._dataset, workspace._request)
	for index: int in machines.item_count:
		if machines.get_item_metadata(index).id == "extended_industrialization:processing_array":
			machines.select(index)
			dialog._machine_changed(index)
	dialog.get_node("%GoalContainedCount").value = 16
	dialog.get_node("%GoalBatch").value = 16
	dialog.get_node("%GoalShape").value = 2
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	if DisplayServer.get_name() != "headless":
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/array-goal-editor.png")
	assert(dialog.size.y < root.size.y)
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._last_result.lines.size() == 1)
	assert(workspace._last_result.lines[0].machine == "extended_industrialization:processing_array")
	assert(workspace._last_result.lines[0].configuration_details.setup.contained_count == 16)
	recipe_node = workspace._nodes.values()[0]
	assert(recipe_node.loadout.text.contains("16 × Electric Macerator inside each array"))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/array-node-inspector.png")
	print("The array editor preserves sixteen contained macerators, batching, and the selected shape.")
	workspace._request.available_machines.append("extended_industrialization:large_electric_furnace")
	for candidate: Dictionary in workspace._dataset.recipes:
		if candidate.get("process", {}).get("type") == "modern_industrialization:furnace" && !candidate.has("unsupported"):
			recipe = candidate
			break
	dialog.open_goal(recipe, workspace._dataset, workspace._request)
	for index: int in machines.item_count:
		if machines.get_item_metadata(index).id == "extended_industrialization:large_electric_furnace":
			machines.select(index)
			dialog._machine_changed(index)
	assert(dialog.get_node("%GoalShape").max_value == 3)
	dialog.get_node("%GoalShape").value = 3
	dialog.get_node("%GoalBatch").value = 64
	dialog._changed()
	await workspace.computation.completed
	await process_frame
	assert(!dialog.get_ok_button().disabled)
	if DisplayServer.get_name() != "headless":
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/furnace-goal-editor.png")
	dialog.hide()
	for candidate: Dictionary in workspace._dataset.recipes:
		if candidate.get("source_id") == "statech:modern_industrialization/macerator/copper_dust_from_copper_cluster":
			recipe = candidate
	workspace._request = {"goals": [{"recipe": recipe.id, "resource": recipe.primary, "rate": 1.0}],
		"available_machines": ["modern_industrialization:bronze_macerator"],
		"external": [{"resource": "item:spectrum:copper_cluster"}, {"resource": "fluid:modern_industrialization:steam"}]}
	workspace._recalculate()
	await workspace.computation.completed
	await process_frame
	assert(workspace.inspector.text.contains("mB Steam per operation"))
	if DisplayServer.get_name() != "headless":
		await create_timer(0.25).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/steam-node-inspector.png")
