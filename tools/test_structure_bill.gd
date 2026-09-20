extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Structural bill check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var path := ""
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--catalog="): path = argument.trim_prefix("--catalog=")
	assert(!path.is_empty())
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string(path))))
	var recipe: Dictionary = {}
	for value: Dictionary in workspace._dataset.recipes:
		if value.primary == "item:modern_industrialization:steel_ingot" && value.get("process", {}).get("type") == "modern_industrialization:blast_furnace":
			recipe = value
			break
	assert(!recipe.is_empty())
	var external: Array[Dictionary] = [{"resource": "energy:eu"}]
	for input: Dictionary in recipe.inputs:
		external.append({"resource": input.get("resource", input.get("choices", [""])[0])})
	workspace._request = {"goals": [{"resource": recipe.primary, "recipe": recipe.id, "rate": 1}], "available_machines": ["modern_industrialization:electric_blast_furnace"], "external": external}
	workspace._positions.clear()
	workspace._groups.clear()
	workspace._pending_view.clear()
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	var line: Dictionary = workspace._last_result.lines[0]
	assert(line.configuration_details.structure.status == "sized")
	assert("Build requirements per machine" in workspace.inspector.text)
	assert("Heatproof Machine Casing" in workspace.inspector.text || "Heatproof Machine Casing".to_lower() in workspace.inspector.text.to_lower())
	if DisplayServer.get_name() != "headless":
		await process_frame
		workspace.inspector.get_v_scroll_bar().value = 280
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/structure-bill.png")
	print("The actual blast-furnace recipe includes its measured structural bill in the plan and inspector.")
	quit()
