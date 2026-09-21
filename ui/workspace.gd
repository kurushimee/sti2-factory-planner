class_name PlannerWorkspace
extends Control

signal layout_settled

@onready var graph: GraphEdit = %Graph
@onready var computation: PlannerComputation = %Computation
@onready var recipes_list: ItemList = %Recipes
@onready var search: LineEdit = %Search
@onready var rate: SpinBox = %Rate
@onready var inspector: RichTextLabel = %Inspector
@onready var status: Label = %Status
@onready var files: FileDialog = %Files

@export var recipe_scene: PackedScene
@export var group_scene: PackedScene
@export_file var default_dataset_path := "res://data/statech-2.0.1.json.gz"

var restore_saved_plan := true

var _dataset: Dictionary[String, Variant] = {}
var _request: Dictionary[String, Variant] = {"goals": [], "replication": false}
var _positions: Dictionary[String, Variant] = {}
var _recipes: Dictionary[String, Dictionary] = {}
var _resources: Dictionary[String, String] = {}
var _inspected_key := ""
var _last_view := Vector3(INF, INF, INF)
var _last_view_key := ""
var _pending_view: Dictionary = {}
var _nodes: Dictionary[String, PlannerRecipeNode] = {}
var _undo: Array[Dictionary] = []
var _redo: Array[Dictionary] = []
var _selected := ""
var _last_result: Dictionary[String, Variant] = {}
var _file_action := "import"
var _job_kind := "solve"
var _rendering := false
var _initial_layout := false
var _unplaced: Array[String] = []
var _groups: Dictionary[String, Dictionary] = {}
var _frames: Dictionary[String, GraphFrame] = {}
var _resizing_group := ""
var _members: Dictionary[String, String] = {}
var _world_import: Dictionary[String, Variant] = {}
var _recipe_matches: Array[String] = []
var _recipe_page := 0
const RECIPE_PAGE_SIZE := 150


func _ready() -> void:
	OS.low_processor_usage_mode = true
	if "--capture" in OS.get_cmdline_user_args() || "--capture-existing" in OS.get_cmdline_user_args():
		OS.low_processor_usage_mode = false
	computation.completed.connect(_calculated)
	computation.failed.connect(_failed)
	computation.progress.connect(func(message: String) -> void: status.text = message)
	search.text_changed.connect(_filter_recipes)
	%PreviousRecipes.pressed.connect(func() -> void: _recipe_page -= 1; _show_recipe_page())
	%NextRecipes.pressed.connect(func() -> void: _recipe_page += 1; _show_recipe_page())
	%AddGoal.pressed.connect(_add_goal)
	%RemoveGoal.pressed.connect(_remove_goal)
	%EditGoal.pressed.connect(_edit_goal)
	%GroupNameDialog.confirmed.connect(_rename_group)
	%GroupName.text_submitted.connect(func(_text: String) -> void:
		if !%GroupNameDialog.get_ok_button().disabled:
			_rename_group()
			%GroupNameDialog.hide()
	)
	%GroupName.text_changed.connect(func(text: String) -> void: %GroupNameDialog.get_ok_button().disabled = text.strip_edges().is_empty())
	var group_controls: Array[Control] = [%GroupName, %GroupNameDialog.get_ok_button(), %GroupNameDialog.get_cancel_button()]
	for index: int in group_controls.size():
		group_controls[index].focus_next = group_controls[index].get_path_to(group_controls[(index + 1) % group_controls.size()])
		group_controls[index].focus_previous = group_controls[index].get_path_to(group_controls[(index + group_controls.size() - 1) % group_controls.size()])
	%Settings.pressed.connect(func() -> void: %FactorySettings.open_settings(_dataset, _request))
	%Summary.pressed.connect(_show_power)
	%FactorySettings.settings_changed.connect(func(request: Dictionary) -> void:
		_remember()
		_request.assign(request)
		_recalculate()
	)
	%GoalEditor.preview_requested.connect(_preview_goal)
	%GoalEditor.goal_changed.connect(_apply_goal)
	%Arrange.pressed.connect(_arrange)
	%AddGroup.pressed.connect(_add_group)
	%Import.pressed.connect(_choose_import)
	%Save.pressed.connect(_choose_export)
	%Undo.pressed.connect(_undo_action)
	%Redo.pressed.connect(_redo_action)
	%Cancel.pressed.connect(_cancel)
	%Replication.toggled.connect(_replication_changed)
	%ReviewWorld.pressed.connect(func() -> void: %WorldReview.open_review(_world_import, _dataset))
	%WorldReview.corrections_requested.connect(_correct_world)
	%Sounds.toggled.connect(func(enabled: bool) -> void: %Feedback.enabled = enabled; _autosave())
	%ReducedMotion.toggled.connect(func(_enabled: bool) -> void: _autosave())
	%Feedback.bind_controls(self)
	%About.pressed.connect(func() -> void: %AboutDialog.open_about(_dataset, %ReducedMotion.button_pressed))
	%AboutDialog.visibility_changed.connect(func() -> void:
		if !%AboutDialog.visible: %About.grab_focus()
	)
	%ViewSaveDelay.timeout.connect(_save_view)
	_setup_focus()
	files.file_selected.connect(_file_selected)
	graph.node_selected.connect(_select_node)
	graph.gui_input.connect(_graph_input)
	graph.end_node_move.connect(_save_positions)
	graph.begin_node_move.connect(_remember)
	graph.delete_nodes_request.connect(_delete_nodes)
	var example_requested := OS.get_cmdline_user_args().has("--example") || OS.get_cmdline_user_args().has("--capture")
	if OS.has_feature("web"):
		example_requested = bool(JavaScriptBridge.eval("new URLSearchParams(window.location.search).get('dataset') === 'example'"))
	var dataset_path := "res://data/example.json" if example_requested else default_dataset_path
	var dataset_bytes := FileAccess.get_file_as_bytes(dataset_path)
	if dataset_path.ends_with(".gz"):
		dataset_bytes = dataset_bytes.decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP)
	if dataset_bytes.is_empty() || !_load_dataset(JSON.parse_string(dataset_bytes.get_string_from_utf8())):
		_failed("The bundled dataset could not be read. Import a valid dataset to recover.")
	if restore_saved_plan && OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.restore()")
	elif restore_saved_plan && FileAccess.file_exists("user://autosave.json"):
		var saved: Variant = JSON.parse_string(FileAccess.get_file_as_string("user://autosave.json"))
		if saved is Dictionary && FileAccess.file_exists("user://workspace-view.json"):
			var view: Variant = JSON.parse_string(FileAccess.get_file_as_string("user://workspace-view.json"))
			if view is Dictionary && view.get("dataset_identity") == saved.get("dataset_identity") && PlannerDatasetValidation.check_view(view.get("view")).is_empty():
				saved.view = view.view
		_restore_plan(saved)
	search.grab_focus.call_deferred()
	if "--capture" in OS.get_cmdline_user_args():
		_request.goals = [{"resource": "motor", "rate": 2.0, "recipe": "assemble"}]
		_recalculate()


func _setup_focus() -> void:
	var controls: Array[Control] = [search, recipes_list, rate.get_line_edit(), %AddGoal, %Replication, %ReducedMotion,
		%PreviousRecipes, %NextRecipes, %Arrange, %AddGroup, %Settings, %Summary, graph, inspector, %EditGoal, %RemoveGoal, %ReviewWorld, %Import, %Save, %Undo, %Redo, %About, %Sounds, %Cancel]
	graph.focus_mode = Control.FOCUS_ALL
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])
	for action: String in ["ui_focus_next", "ui_focus_prev"]:
		var event := InputEventJoypadButton.new()
		event.button_index = JOY_BUTTON_RIGHT_SHOULDER if action == "ui_focus_next" else JOY_BUTTON_LEFT_SHOULDER
		if !InputMap.action_has_event(action, event):
			InputMap.action_add_event(action, event)
	for action: String in ["ui_accept", "ui_cancel", "ui_close_dialog"]:
		var event := InputEventJoypadButton.new()
		event.button_index = JOY_BUTTON_A if action == "ui_accept" else JOY_BUTTON_B
		if !InputMap.action_has_event(action, event):
			InputMap.action_add_event(action, event)


func _graph_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		search.grab_focus()
		graph.accept_event()
		return
	if event.is_action_pressed("ui_accept"):
		_edit_goal.call_deferred()
		graph.accept_event()
		return
	var direction := Vector2.ZERO
	for action: String in ["ui_left", "ui_right", "ui_up", "ui_down"]:
		if event.is_action_pressed(action, true):
			direction = {"ui_left": Vector2.LEFT, "ui_right": Vector2.RIGHT, "ui_up": Vector2.UP, "ui_down": Vector2.DOWN}[action]
	if direction == Vector2.ZERO || _nodes.is_empty():
		return
	var current: PlannerRecipeNode = null
	for node: PlannerRecipeNode in _nodes.values():
		if node.get_meta("position_key") == _inspected_key:
			current = node
	var next: PlannerRecipeNode = null
	var score := INF
	if current:
		for node: PlannerRecipeNode in _nodes.values():
			var offset := node.position_offset + node.size / 2.0 - current.position_offset - current.size / 2.0
			if offset.dot(direction) <= 0.0:
				continue
			var distance := offset.length() + absf(offset.cross(direction)) * 2.0
			if distance < score:
				score = distance
				next = node
	else:
		next = _nodes.values()[0]
	if next:
		for node: PlannerRecipeNode in _nodes.values():
			node.selected = node == next
		_select_node(next)
		graph.scroll_offset = (next.position_offset + next.size / 2.0) * graph.zoom - graph.size / 2.0
	graph.accept_event()


func _process(_delta: float) -> void:
	var view := Vector3(graph.zoom, graph.scroll_offset.x, graph.scroll_offset.y)
	if view != _last_view || _inspected_key != _last_view_key:
		_last_view = view
		_last_view_key = _inspected_key
		%ViewSaveDelay.start()
	if !OS.has_feature("web"):
		return
	var response: Variant = JavaScriptBridge.eval("window.plannerBridge.pollFile()")
	if !(response is String) || response.is_empty():
		return
	var event: Dictionary = JSON.parse_string(response)
	match event.kind:
		"json":
			_import_json(event.value)
		"world":
			_import_world("")
		"error":
			_failed(event.message)


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey && event.pressed && event.ctrl_pressed:
		match event.keycode:
			KEY_Z:
				_redo_action() if event.shift_pressed else _undo_action()
			KEY_Y:
				_redo_action()
			KEY_S:
				_choose_export()
			KEY_F:
				search.grab_focus()
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton && event.button_index == MOUSE_BUTTON_LEFT && !event.pressed && !_resizing_group.is_empty():
		_save_positions.call_deferred()


func _load_dataset(value: Variant) -> bool:
	var error := PlannerDatasetValidation.check(value)
	if !error.is_empty():
		_failed(error)
		return false
	var next_dataset: Dictionary[String, Variant] = {}
	next_dataset.assign(value)
	_dataset = next_dataset
	_recipes.clear()
	_resources.clear()
	for resource: Dictionary in _dataset.resources:
		_resources[resource.id] = PlannerDisplay.readable_name(resource.id, resource.get("name", ""))
	for recipe: Dictionary in _dataset.recipes:
		_recipes[recipe.id] = recipe
	%DatasetName.text = "%s  ·  %s" % [_dataset.get("name", "Custom dataset"), _dataset.get("description", "")]
	_filter_recipes(search.text)
	return true


func _filter_recipes(query: String) -> void:
	_recipe_matches.clear()
	_recipe_page = 0
	var normalized := query.to_lower()
	for recipe: Dictionary in _dataset.get("recipes", []):
		var title: String = PlannerDisplay.recipe_name(recipe)
		if !normalized.is_empty() && !normalized in (title + " " + recipe.id).to_lower():
			continue
		_recipe_matches.append(recipe.id)
	_show_recipe_page()


func _show_recipe_page() -> void:
	recipes_list.clear()
	var first := _recipe_page * RECIPE_PAGE_SIZE
	var last := mini(first + RECIPE_PAGE_SIZE, _recipe_matches.size())
	for match_index: int in range(first, last):
		var recipe: Dictionary = _recipes[_recipe_matches[match_index]]
		var title: String = PlannerDisplay.recipe_name(recipe)
		var index := recipes_list.add_item(title)
		recipes_list.set_item_metadata(index, recipe.id)
		recipes_list.set_item_tooltip(index, recipe.get("unsupported", recipe.id))
	%RecipePage.text = "%d–%d / %d" % [first + 1 if last > first else 0, last, _recipe_matches.size()]
	%PreviousRecipes.disabled = first == 0
	%NextRecipes.disabled = last >= _recipe_matches.size()
	if recipes_list.item_count:
		recipes_list.select(0)


func _add_goal() -> void:
	var indices := recipes_list.get_selected_items()
	if indices.is_empty():
		return
	_remember()
	var id: String = recipes_list.get_item_metadata(indices[0])
	var recipe: Dictionary = _recipes[id]
	var existing := false
	for goal: Dictionary in _request.goals:
		if goal.get("recipe") == id && goal.get("kind", "rate") == "rate":
			goal.rate += rate.value
			existing = true
	if !existing:
		_request.goals.append({"resource": recipe.primary, "rate": rate.value, "recipe": id})
	_recalculate()


func _remove_goal() -> void:
	if _selected.is_empty():
		return
	_remember()
	if _groups.has(_selected):
		_groups.erase(_selected)
		_restore_groups()
		_autosave()
		return
	_request.goals = _request.goals.filter(func(goal: Dictionary) -> bool: return goal.get("recipe") != _selected)
	_recalculate()


func _edit_goal() -> void:
	if _groups.has(_selected):
		%GroupNameDialog.set_meta("group_key", _selected)
		%GroupName.text = _groups[_selected].title
		%GroupNameDialog.get_ok_button().disabled = false
		%GroupNameDialog.popup_centered(Vector2i(460, 150))
		%GroupName.select_all()
		%GroupName.grab_focus.call_deferred()
	elif _recipes.has(_selected):
		%GoalEditor.open_goal(_recipes[_selected], _dataset, _request)


func _rename_group() -> void:
	var key: String = %GroupNameDialog.get_meta("group_key", "")
	var title: String = %GroupName.text.strip_edges()
	if !_groups.has(key) || title.is_empty() || _groups[key].title == title:
		return
	_remember()
	_groups[key].title = title
	_frames[key].title = title
	_select_node(_frames[key])
	_autosave()


func _preview_goal(selection: Dictionary) -> void:
	_job_kind = "preview_configuration"
	computation.submit({"kind": _job_kind, "dataset": _dataset, "request": _request, "selection": selection})


func _apply_goal(index: int, goal: Dictionary, selection: Dictionary, pin: bool) -> void:
	_remember()
	if index >= 0:
		if _request.goals[index].has("origins"):
			goal.origins = _request.goals[index].origins
		_request.goals[index] = goal
	else:
		_request.goals.append(goal)
	if selection.has("setup"):
		if !_request.has("machine_setups"):
			_request.machine_setups = {}
		if !_request.machine_setups.has(goal.recipe):
			_request.machine_setups[goal.recipe] = []
		var setup: Dictionary = {"machine": selection.machine, "setup": selection.setup, "configuration": selection.configuration}
		if !setup in _request.machine_setups[goal.recipe]:
			_request.machine_setups[goal.recipe].append(setup)
	if !_request.has("configurations"):
		_request.configurations = {}
	if pin && goal.kind != "capacity":
		_request.configurations[goal.recipe] = selection.configuration
	else:
		_request.configurations.erase(goal.recipe)
	_recalculate()


func _replication_changed(enabled: bool) -> void:
	_remember()
	_request.replication = enabled
	_recalculate()


func _recalculate() -> void:
	_job_kind = "solve"
	%Cancel.disabled = false
	var request := _request.duplicate(true)
	computation.submit({"dataset": _dataset, "request": request})


func _calculated(result: Dictionary) -> void:
	%Cancel.disabled = true
	if _job_kind == "preview_configuration":
		%GoalEditor.show_preview(result)
		status.text = "Configuration preview updated. Apply the goal to recalculate its support."
		return
	if _job_kind in ["import_world", "correct_world"]:
		var apply_empty: bool = _job_kind == "correct_world" && !_world_import.get("reconstruction", {}).get("goals", []).is_empty()
		var replace_infrastructure: bool = !result.get("reconstruction", {}).get("infrastructure", []).is_empty() || (_job_kind == "correct_world" && !_world_import.get("reconstruction", {}).get("infrastructure", []).is_empty())
		_remember()
		_world_import.assign(result)
		%ReviewWorld.disabled = false
		var reconstruction: Dictionary = result.get("reconstruction", {})
		var goals: Array = reconstruction.get("goals", [])
		if replace_infrastructure:
			_request.infrastructure = reconstruction.get("infrastructure", []).duplicate(true)
		if !goals.is_empty() || apply_empty:
			_request.goals = goals.duplicate(true)
			_request.machine_setups = reconstruction.get("machine_setups", {}).duplicate(true)
			_request.ingredients = reconstruction.get("ingredients", {}).duplicate(true)
			var obtained: Array = _request.get("obtained_resources", []).duplicate()
			for resource: String in reconstruction.get("obtained_resources", []):
				if !resource in obtained:
					obtained.append(resource)
			_request.obtained_resources = obtained
			_request.erase("routes")
			_request.erase("configurations")
			var available: Array = _request.get("available_machines", _dataset.get("default_machines", [])).duplicate()
			for setups: Array in _request.machine_setups.values():
				for setup: Dictionary in setups:
					if !setup.machine in available:
						available.append(setup.machine)
					var contained: String = setup.get("setup", {}).get("contained_machine", "")
					if !contained.is_empty() && !contained in available:
						available.append(contained)
			if !available.is_empty():
				_request.available_machines = available
		_autosave()
		%Notice.dialog_text = "Read %d machines and %d pattern providers.\n%d capacity goals; %d infrastructure configurations; %d assignments need correction.\n%d unsupported entries; %d read errors.\n\nUse Imported factory to review assignments and end goals. Stored quantities are not production rates." % [result.machines.size(), result.providers.size(), goals.size(), reconstruction.get("infrastructure", []).size(), reconstruction.get("unresolved", []).size(), result.unsupported.size(), result.errors.size()]
		%Notice.popup_centered()
		status.text = "World configuration read locally."
		if !goals.is_empty() || apply_empty || replace_infrastructure:
			_recalculate()
		return
	if result.get("status") != "optimal":
		_failed("The goals could not be solved (%s). Check available routes and supplies. The previous graph is preserved." % result.get("status", "unknown"))
		return
	_last_result.assign(result)
	_render_plan(result)
	status.text = "Plan updated. Shared demand and generation support are included."
	_autosave()
	if "--capture" in OS.get_cmdline_user_args() || "--capture-existing" in OS.get_cmdline_user_args():
		await get_tree().create_timer(0.5).timeout
		await RenderingServer.frame_post_draw
		var capture_path := "res://.plans/artifacts/workspace/first.png"
		for argument: String in OS.get_cmdline_user_args():
			if argument.begins_with("--capture-path="):
				capture_path = argument.trim_prefix("--capture-path=")
		get_viewport().get_texture().get_image().save_png(capture_path)
		get_tree().quit()


func _render_plan(result: Dictionary) -> void:
	_initial_layout = _positions.is_empty() && _groups.is_empty()
	_unplaced.clear()
	_rendering = true
	graph.clear_connections()
	for node: PlannerRecipeNode in _nodes.values():
		graph.remove_child(node)
		node.queue_free()
	_nodes.clear()
	var machine_count := 0
	for index: int in result.lines.size():
		var line: Dictionary = result.lines[index]
		var node := recipe_scene.instantiate() as PlannerRecipeNode
		node.name = "line_%d" % index
		graph.add_child(node)
		node.configure(line, _recipes[line.recipe], _resources)
		var key := String(line.recipe) + "|" + String(line.configuration)
		node.set_meta("position_key", key)
		if !_positions.has(key):
			_unplaced.append(key)
		var saved: Array = _positions.get(key, [45 + (index % 2) * 355, 75 + (index / 2) * 300])
		node.position_offset = Vector2(saved[0], saved[1])
		_nodes[String(node.name)] = node
		machine_count += int(line.machines)
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
	for connection: Dictionary in result.get("connections", []):
		if !by_key.has(connection.source) || !by_key.has(connection.destination):
			continue
		var source: PlannerRecipeNode = by_key[connection.source]
		var destination: PlannerRecipeNode = by_key[connection.destination]
		graph.connect_node(source.name, source.output_ports[connection.resource], destination.name, destination.input_ports[connection.resource])
	%Summary.text = "%d %s  ·  Power details" % [machine_count, "machine" if machine_count == 1 else "machines"]
	_rendering = false
	_restore_groups()
	_settle_node_sizes.call_deferred()
	if !%ReducedMotion.button_pressed:
		var tween := create_tween()
		tween.tween_property(graph, "modulate:a", 1.0, 0.18).from(0.5)
	if !_nodes.is_empty():
		_select_node(by_key.get(_inspected_key, _nodes.values()[0]))
	else:
		_selected = ""
		inspector.text = "Select a recipe and add a goal to start planning."
		%RemoveGoal.disabled = true
		%EditGoal.disabled = true


func _settle_node_sizes() -> void:
	# Wrapped labels need their assigned width before GraphNode can discard its initial height estimate.
	await get_tree().process_frame
	for node: PlannerRecipeNode in _nodes.values():
		node.reset_size()
	if _initial_layout && !_nodes.is_empty():
		_initial_layout = false
		_apply_layout()
	elif !_unplaced.is_empty():
		_place_new_nodes()
	if !_pending_view.is_empty():
		graph.zoom = clampf(float(_pending_view.zoom), graph.zoom_min, graph.zoom_max)
		graph.scroll_offset = Vector2(_pending_view.scroll[0], _pending_view.scroll[1])
		_pending_view.clear()
	_update_membership()
	layout_settled.emit()


func _select_node(node: Node) -> void:
	if node is GraphFrame:
		%EditGoal.disabled = false
		%EditGoal.text = "Rename group"
		_selected = String(node.name)
		inspector.text = "[font_size=20]%s[/font_size]\n\nDrag the title to move this group and its members. Resize a border to change membership without moving recipes.\n\nA recipe belongs to the smallest group containing its center. Equal-sized overlaps use the group's stable ID.\n\n%d member nodes" % [PlannerDisplay.markup(node.title), _members.values().count(String(node.name))]
		%RemoveGoal.text = "Remove group"
		%RemoveGoal.disabled = false
		return
	if !(node is PlannerRecipeNode):
		return
	%EditGoal.text = "Edit production goal"
	_selected = node.recipe_id
	_inspected_key = node.get_meta("position_key")
	node.selected = true
	%EditGoal.disabled = false
	var line: Dictionary = node.allocation
	inspector.text = PlannerDisplay.inspection(line, _recipes[line.recipe], _resources, _last_result.get("startup", {}), _last_result.get("construction", {}))
	%RemoveGoal.text = "Remove selected goal"
	%RemoveGoal.disabled = !_request.goals.any(func(goal: Dictionary) -> bool: return goal.get("recipe") == _selected)


func _show_power() -> void:
	inspector.text = PlannerDisplay.power_report(_last_result.get("power", {}), _resources, _last_result.get("construction", {}))
	inspector.scroll_to_line(0)
	%EditGoal.disabled = true
	%RemoveGoal.disabled = true
	inspector.grab_focus()


func _arrange() -> void:
	_remember()
	_apply_layout()


func _apply_layout() -> void:
	var entries: Array[PlannerGraphLayout.Entry] = []
	for node: PlannerRecipeNode in _nodes.values():
		var recipe: Dictionary = _recipes[node.recipe_id]
		var group: String = recipe.get("group", "Power" if recipe.primary == "energy:eu" else "Production")
		entries.append(PlannerGraphLayout.Entry.new(node.get_meta("position_key"), group, node.size))
	var layout := PlannerGraphLayout.arrange(entries, _last_result.get("connections", []))
	_rendering = true
	for node: PlannerRecipeNode in _nodes.values():
		node.position_offset = layout.positions[node.get_meta("position_key")]
	_groups.clear()
	var index := 0
	var bounds := Rect2()
	for title: String in layout.groups:
		var rect: Rect2 = layout.groups[title]
		_groups["category_%d" % index] = {"title": title, "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y]}
		bounds = rect if index == 0 else bounds.merge(rect)
		index += 1
	_rendering = false
	_restore_groups()
	if bounds.size.x > 0 && bounds.size.y > 0:
		graph.zoom = clampf(minf((graph.size.x - 60) / bounds.size.x, (graph.size.y - 90) / bounds.size.y), graph.zoom_min, 1.0)
		graph.scroll_offset = bounds.position * graph.zoom - Vector2(30, 55)
	_unplaced.clear()
	_save_positions()
	status.text = "Recipes arranged into production groups. Drag nodes and groups to adjust the layout."


func _place_new_nodes() -> void:
	var right := 25.0
	for node: PlannerRecipeNode in _nodes.values():
		if !node.get_meta("position_key") in _unplaced:
			right = maxf(right, node.position_offset.x + node.size.x + 80)
	for frame: GraphFrame in _frames.values():
		right = maxf(right, frame.position_offset.x + frame.size.x + 80)
	var y := 75.0
	for node: PlannerRecipeNode in _nodes.values():
		if node.get_meta("position_key") in _unplaced:
			node.position_offset = Vector2(right, y)
			y += node.size.y + 32
	_unplaced.clear()
	_save_positions()


func _add_group() -> void:
	_initial_layout = false
	_unplaced.clear()
	_remember()
	var key := "group_%d" % Time.get_ticks_usec()
	var position := graph.scroll_offset / graph.zoom + Vector2(25, 55)
	_groups[key] = {"title": "Production line %d" % (_groups.size() + 1), "rect": [position.x, position.y, 660.0, 360.0]}
	_restore_groups()
	_autosave()
	status.text = "Drag the group title to move its members. Resize its border to change membership."


func _restore_groups() -> void:
	_rendering = true
	for frame: GraphFrame in _frames.values():
		graph.remove_child(frame)
		frame.queue_free()
	_frames.clear()
	for key: String in _groups:
		var frame := group_scene.instantiate() as GraphFrame
		frame.name = key
		frame.title = _groups[key].title
		var rect: Array = _groups[key].rect
		graph.add_child(frame)
		graph.move_child(frame, 0)
		frame.position_offset = Vector2(rect[0], rect[1])
		frame.size = Vector2(rect[2], rect[3])
		frame.position_offset_changed.connect(_group_moved.bind(key))
		frame.resize_request.connect(func(new_size: Vector2) -> void:
			if _resizing_group != key:
				_remember()
				_resizing_group = key
			frame.size = new_size
			_groups[key].rect = [frame.position_offset.x, frame.position_offset.y, new_size.x, new_size.y]
			_update_membership()
		)
		_frames[key] = frame
	_rendering = false
	_update_membership.call_deferred()


func _group_moved(key: String) -> void:
	if _rendering || !_frames.has(key):
		return
	var frame: GraphFrame = _frames[key]
	var previous: Array = _groups[key].rect
	var delta := frame.position_offset - Vector2(previous[0], previous[1])
	for node_name: String in _members:
		if _members[node_name] == key && _nodes.has(node_name):
			_nodes[node_name].position_offset += delta
	_groups[key].rect = [frame.position_offset.x, frame.position_offset.y, previous[2], previous[3]]


func _update_membership() -> void:
	_members.clear()
	for node: PlannerRecipeNode in _nodes.values():
		var chosen := ""
		var area := INF
		var keys: Array[String] = []
		keys.assign(_frames.keys())
		keys.sort()
		for key: String in keys:
			var frame: GraphFrame = _frames[key]
			var rect := Rect2(frame.position_offset, frame.size)
			if rect.has_point(node.position_offset + node.size / 2) && rect.get_area() < area:
				chosen = key
				area = rect.get_area()
		if !chosen.is_empty():
			_members[String(node.name)] = chosen


func _save_positions() -> void:
	if _rendering:
		return
	for node: PlannerRecipeNode in _nodes.values():
		_positions[node.get_meta("position_key")] = [node.position_offset.x, node.position_offset.y]
	_resizing_group = ""
	_update_membership()
	_autosave()


func _delete_nodes(names: Array[StringName]) -> void:
	_remember()
	var ids: Array[String] = []
	for node_name: StringName in names:
		if _nodes.has(node_name):
			ids.append(_nodes[node_name].recipe_id)
		elif _groups.has(node_name):
			_groups.erase(node_name)
	_request.goals = _request.goals.filter(func(goal: Dictionary) -> bool: return !goal.get("recipe") in ids)
	_recalculate()


func _snapshot() -> Dictionary:
	for node: PlannerRecipeNode in _nodes.values():
		_positions[node.get_meta("position_key")] = [node.position_offset.x, node.position_offset.y]
	return {"format": "factory-plan", "version": 1, "dataset_identity": _dataset.get("identity", "custom"), "dataset": _dataset,
		"view": _pending_view.duplicate(true) if !_pending_view.is_empty() else _view_snapshot(),
		"request": _request.duplicate(true), "positions": _positions.duplicate(true), "groups": _groups.duplicate(true), "imported_world": _world_import.duplicate(true),
		"preferences": {"sound": %Sounds.button_pressed, "reduced_motion": %ReducedMotion.button_pressed}}


func _remember() -> void:
	_undo.append(_snapshot())
	if _undo.size() > 100:
		_undo.pop_front()
	_redo.clear()


func _undo_action() -> void:
	if _undo.is_empty():
		return
	_redo.append(_snapshot())
	_restore_plan(_undo.pop_back())


func _redo_action() -> void:
	if _redo.is_empty():
		return
	_undo.append(_snapshot())
	_restore_plan(_redo.pop_back())


func _restore_plan(value: Variant) -> void:
	var error := PlannerDatasetValidation.check_plan(value)
	if !error.is_empty():
		_failed(error)
		return
	if !_load_dataset(value.dataset):
		return
	_request.assign(value.request)
	%ViewSaveDelay.stop()
	_pending_view = value.get("view", {"zoom": 1.0, "scroll": [0, 0], "inspected": ""}).duplicate(true)
	_inspected_key = _pending_view.get("inspected", "")
	_positions.assign(value.get("positions", {}))
	_groups.assign(value.get("groups", {}))
	_world_import.assign(value.get("imported_world", {}))
	%ReviewWorld.disabled = _world_import.is_empty()
	var preferences: Dictionary = value.get("preferences", {})
	%Sounds.set_pressed_no_signal(preferences.get("sound", false))
	%Feedback.enabled = %Sounds.button_pressed
	%ReducedMotion.set_pressed_no_signal(preferences.get("reduced_motion", false))
	%Replication.set_pressed_no_signal(_request.get("replication", false))
	_recalculate()


func _autosave() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.save(%s)" % JSON.stringify(_snapshot()))
		return
	var file := FileAccess.open("user://autosave.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(_snapshot()))
	file.close()
	_save_view()


func _view_snapshot() -> Dictionary:
	return {"zoom": graph.zoom, "scroll": [graph.scroll_offset.x, graph.scroll_offset.y], "inspected": _inspected_key}


func _save_view() -> void:
	if _dataset.is_empty() || !_pending_view.is_empty():
		return
	var record := {"dataset_identity": _dataset.get("identity", "custom"), "view": _view_snapshot()}
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.saveView(%s)" % JSON.stringify(record))
	else:
		var file := FileAccess.open("user://workspace-view.json", FileAccess.WRITE)
		file.store_string(JSON.stringify(record))
		file.close()


func _choose_import() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.chooseFile()")
		return
	_file_action = "import"
	files.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	files.popup_centered()


func _choose_export() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.download(%s)" % JSON.stringify(_snapshot()))
		return
	_file_action = "export"
	files.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	files.current_file = "factory-plan.json"
	files.popup_centered()


func _file_selected(path: String) -> void:
	if _file_action == "export":
		var file := FileAccess.open(path, FileAccess.WRITE)
		file.store_string(JSON.stringify(_snapshot(), "  "))
		status.text = "Plan exported."
	elif path.get_extension().to_lower() == "zip":
		_import_world(path)
	else:
		_import_json(JSON.parse_string(FileAccess.get_file_as_string(path)))


func _import_world(path: String) -> void:
	_job_kind = "import_world"
	%Cancel.disabled = false
	computation.submit({"kind": "import_world", "path": path, "dataset": _dataset})


func _correct_world(corrections: Dictionary) -> void:
	_job_kind = "correct_world"
	%Cancel.disabled = false
	computation.submit({"kind": "reconstruct_world", "world": _world_import, "corrections": corrections, "dataset": _dataset})


func _import_json(parsed: Variant) -> void:
	if parsed is Dictionary && str(parsed.get("format")) == "factory-plan":
		_remember()
		_restore_plan(parsed)
	elif PlannerDatasetValidation.check(parsed).is_empty():
		_remember()
		_load_dataset(parsed)
		_request = {"goals": []}
		_positions.clear()
		_groups.clear()
		_world_import.clear()
		_recalculate()
	else:
		_failed(PlannerDatasetValidation.check(parsed))


func _cancel() -> void:
	computation.cancel()
	%Cancel.disabled = true
	status.text = "Calculation cancelled. The current graph is preserved."


func _failed(message: String) -> void:
	if _job_kind == "preview_configuration" && %GoalEditor.visible:
		%GoalEditor.show_error(message)
		return
	%Feedback.error()
	%Cancel.disabled = true
	status.text = message
	status.tooltip_text = message
