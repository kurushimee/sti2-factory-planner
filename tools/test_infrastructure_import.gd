extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Infrastructure import check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var selection := {"id": "world:minecraft:overworld|256|100|0", "machine": "extended_industrialization:tesla_tower", "variant": "0", "count": 1, "energy_hatch": "modern_industrialization:lv_energy_input_hatch", "transmit_eu_per_tick": 1536}
	var second := selection.duplicate(true)
	second.id = "world:minecraft:overworld|512|100|0"
	second.energy_hatch = "modern_industrialization:mv_energy_input_hatch"
	workspace._request = {"goals": [], "external": [{"resource": "energy:eu"}], "available_machines": []}
	workspace._job_kind = "import_world"
	workspace._calculated({"machines": [], "providers": [], "unsupported": [], "errors": [], "reconstruction": {"goals": [], "infrastructure": [selection, second]}})
	workspace.get_node("%Notice").hide()
	assert(workspace._request.infrastructure.size() == 2)
	await workspace.computation.completed
	assert(workspace._last_result.power.infrastructure.total_eu_per_tick == 128)
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	dialog.get_node("%SettingsCategory").select(7)
	dialog._category_changed(7)
	assert(dialog._entries.size() == 7)
	var row: TreeItem = dialog.get_node("%SettingsEntries").get_root().get_first_child()
	while row.get_metadata(0) != selection.id:
		row = row.get_next()
	row.select(0)
	dialog._entry_selected()
	dialog.get_node("%InfrastructureCount").value = 2
	assert(dialog._request.infrastructure[0].count == 2)
	assert(dialog._request.infrastructure[1].count == 1)
	assert(dialog._request.infrastructure[1].energy_hatch == second.energy_hatch)
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-infrastructure-settings.png")
	dialog.hide()
	workspace._job_kind = "correct_world"
	workspace._calculated({"machines": [], "providers": [], "unsupported": [], "errors": [], "reconstruction": {"goals": [], "infrastructure": []}})
	workspace.get_node("%Notice").hide()
	assert(workspace._request.infrastructure.is_empty())
	await workspace.computation.completed
	assert(workspace._last_result.power.infrastructure.total_eu_per_tick == 0)
	print("Infrastructure-only imports, separate receiver tiers, per-tower editing, and removal passed.")
	quit()
