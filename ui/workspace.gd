class_name PlannerWorkspace
extends Control

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

var _dataset: Dictionary[String, Variant] = {}
var _request: Dictionary[String, Variant] = {"goals": [], "replication": false}
var _positions: Dictionary[String, Variant] = {}
var _recipes: Dictionary[String, Dictionary] = {}
var _resources: Dictionary[String, String] = {}
var _nodes: Dictionary[String, PlannerRecipeNode] = {}
var _undo: Array[Dictionary] = []
var _redo: Array[Dictionary] = []
var _selected := ""
var _last_result: Dictionary[String, Variant] = {}
var _file_action := "import"
var _job_kind := "solve"
var _rendering := false
var _groups: Dictionary[String, Dictionary] = {}
var _frames: Dictionary[String, GraphFrame] = {}
var _resizing_group := ""
var _members: Dictionary[String, String] = {}
var _world_import: Dictionary[String, Variant] = {}
var _recipe_matches: Array[String] = []
var _recipe_page := 0
const RECIPE_PAGE_SIZE := 150


func _ready() -> void:
	for action: String in ["ui_accept", "ui_cancel"]:
		var event := InputEventJoypadButton.new()
		event.button_index = JOY_BUTTON_A if action == "ui_accept" else JOY_BUTTON_B
		InputMap.action_add_event(action, event)
	OS.low_processor_usage_mode = true
	if "--capture" in OS.get_cmdline_user_args():
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
	_setup_focus()
	files.file_selected.connect(_file_selected)
	graph.node_selected.connect(_select_node)
	graph.end_node_move.connect(_save_positions)
	graph.begin_node_move.connect(_remember)
	graph.delete_nodes_request.connect(_delete_nodes)
	_load_dataset(JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json")))
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.restore()")
	elif FileAccess.file_exists("user://autosave.json"):
		_restore_plan(JSON.parse_string(FileAccess.get_file_as_string("user://autosave.json")))
	search.grab_focus.call_deferred()
	if "--capture" in OS.get_cmdline_user_args():
		_request.goals = [{"resource": "motor", "rate": 2.0, "recipe": "assemble"}]
		_recalculate()


func _setup_focus() -> void:
	var controls: Array[Control] = [search, recipes_list, rate.get_line_edit(), %AddGoal, %Replication, %ReducedMotion,
		%PreviousRecipes, %NextRecipes, %Arrange, %AddGroup, graph, %EditGoal, %RemoveGoal, %ReviewWorld, %Import, %Save, %Undo, %Redo, %Sounds, %Cancel]
	graph.focus_mode = Control.FOCUS_ALL
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])
	for action: String in ["ui_focus_next", "ui_focus_prev"]:
		var event := InputEventJoypadButton.new()
		event.button_index = JOY_BUTTON_RIGHT_SHOULDER if action == "ui_focus_next" else JOY_BUTTON_LEFT_SHOULDER
		if !InputMap.action_has_event(action, event):
			InputMap.action_add_event(action, event)


func _process(_delta: float) -> void:
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
		_resources[resource.id] = resource.get("name", resource.id)
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
		var title: String = recipe.get("name", recipe.id)
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
		var title: String = recipe.get("name", recipe.id)
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
	if _recipes.has(_selected):
		%GoalEditor.open_goal(_recipes[_selected], _dataset, _request)


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
		_remember()
		_world_import.assign(result)
		%ReviewWorld.disabled = false
		var reconstruction: Dictionary = result.get("reconstruction", {})
		var goals: Array = reconstruction.get("goals", [])
		if !goals.is_empty() || apply_empty:
			_request.goals = goals.duplicate(true)
			_request.machine_setups = reconstruction.get("machine_setups", {}).duplicate(true)
			_request.erase("routes")
			_request.erase("configurations")
			var available: Array = _request.get("available_machines", _dataset.get("default_machines", [])).duplicate()
			for setups: Array in _request.machine_setups.values():
				for setup: Dictionary in setups:
					if !setup.machine in available:
						available.append(setup.machine)
			if !available.is_empty():
				_request.available_machines = available
		_autosave()
		%Notice.dialog_text = "Read %d machines and %d pattern providers.\n%d capacity goals; %d assignments need correction.\n%d unsupported entries; %d read errors.\n\nUse Imported factory to review assignments and end goals. Stored quantities are not production rates." % [result.machines.size(), result.providers.size(), goals.size(), reconstruction.get("unresolved", []).size(), result.unsupported.size(), result.errors.size()]
		%Notice.popup_centered()
		status.text = "World configuration read locally."
		if !goals.is_empty() || apply_empty:
			_recalculate()
		return
	if result.get("status") != "optimal":
		_failed("The goals could not be solved (%s). Check available routes and supplies. The previous graph is preserved." % result.get("status", "unknown"))
		return
	_last_result.assign(result)
	_render_plan(result)
	status.text = "Plan updated. Shared demand and generation support are included."
	_autosave()
	if "--capture" in OS.get_cmdline_user_args():
		await get_tree().create_timer(0.5).timeout
		await RenderingServer.frame_post_draw
		var capture_path := "res://.plans/artifacts/workspace/first.png"
		for argument: String in OS.get_cmdline_user_args():
			if argument.begins_with("--capture-path="):
				capture_path = argument.trim_prefix("--capture-path=")
		get_viewport().get_texture().get_image().save_png(capture_path)
		get_tree().quit()


func _render_plan(result: Dictionary) -> void:
	_rendering = true
	graph.clear_connections()
	for node: PlannerRecipeNode in _nodes.values():
		graph.remove_child(node)
		node.queue_free()
	_nodes.clear()
	var machine_count := 0
	var power_total := 0.0
	for index: int in result.lines.size():
		var line: Dictionary = result.lines[index]
		var node := recipe_scene.instantiate() as PlannerRecipeNode
		node.name = "line_%d" % index
		graph.add_child(node)
		node.configure(line, _recipes[line.recipe], _resources)
		var key := String(line.recipe) + "|" + String(line.configuration)
		node.set_meta("position_key", key)
		var saved: Array = _positions.get(key, [45 + (index % 2) * 355, 75 + (index / 2) * 300])
		node.position_offset = Vector2(saved[0], saved[1])
		_nodes[String(node.name)] = node
		machine_count += int(line.machines)
		power_total += float(line.power_eu_per_tick)
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
	for connection: Dictionary in result.get("connections", []):
		if !by_key.has(connection.source) || !by_key.has(connection.destination):
			continue
		var source: PlannerRecipeNode = by_key[connection.source]
		var destination: PlannerRecipeNode = by_key[connection.destination]
		graph.connect_node(source.name, source.output_ports[connection.resource], destination.name, destination.input_ports[connection.resource])
	%Summary.text = "%d machines  ·  %s EU/t" % [machine_count, String.num(power_total, 2)]
	_rendering = false
	_restore_groups()
	if !%ReducedMotion.button_pressed:
		var tween := create_tween()
		tween.tween_property(graph, "modulate:a", 1.0, 0.18).from(0.5)
	if !_nodes.is_empty():
		_select_node(_nodes.values()[0])
	else:
		_selected = ""
		inspector.text = "Select a recipe and add a goal to start planning."
		%RemoveGoal.disabled = true
		%EditGoal.disabled = true


func _select_node(node: Node) -> void:
	if node is GraphFrame:
		%EditGoal.disabled = true
		_selected = String(node.name)
		inspector.text = "[font_size=20]%s[/font_size]\n\nDrag the title to move this group and its members. Resize a border to change membership without moving recipes.\n\nA recipe belongs to the smallest group containing its center. Equal-sized overlaps use the group's stable ID.\n\n%d member nodes" % [node.title, _members.values().count(String(node.name))]
		%RemoveGoal.text = "Remove group"
		%RemoveGoal.disabled = false
		return
	if !(node is PlannerRecipeNode):
		return
	_selected = node.recipe_id
	%EditGoal.disabled = false
	var line: Dictionary = node.allocation
	var text := "[font_size=20]%s[/font_size]\n\n%d × %s\n\n[b]Production[/b]\n" % [node.title, int(line.machines), line.machine]
	for flow: Dictionary in line.outputs:
		text += "%s: %s /s\n" % [_resources.get(flow.resource, flow.resource), String.num(flow.rate, 4)]
	text += "\n[b]Ingredients[/b]\n"
	for flow: Dictionary in line.inputs:
		text += "%s: %s /s\n" % [_resources.get(flow.resource, flow.resource), String.num(flow.rate, 4)]
	text += "\n[b]Capacity[/b]\n%s operations/s\n%s%% utilized\n\n[b]Power[/b]\n%s EU/t sustained\n\n[font_size=12]%s[/font_size]" % [String.num(line.capacity_per_second, 4), String.num(line.utilization * 100, 1), String.num(line.power_eu_per_tick, 3), line.recipe]
	inspector.text = text
	%RemoveGoal.text = "Remove selected goal"
	%RemoveGoal.disabled = !_request.goals.any(func(goal: Dictionary) -> bool: return goal.get("recipe") == _selected)


func _arrange() -> void:
	_remember()
	graph.arrange_nodes()
	_save_positions.call_deferred()


func _add_group() -> void:
	_remember()
	var key := "group_%d" % Time.get_ticks_usec()
	var position := graph.scroll_offset / graph.zoom + Vector2(25, 55)
	_groups[key] = {"title": "Production line %d" % (_groups.size() + 1), "rect": [position.x, position.y, 660, 360]}
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
	_groups[key].rect = [frame.position_offset.x, frame.position_offset.y, frame.size.x, frame.size.y]


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
	for key: String in _frames:
		var frame: GraphFrame = _frames[key]
		_groups[key].rect = [frame.position_offset.x, frame.position_offset.y, frame.size.x, frame.size.y]
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
	if parsed is Dictionary && parsed.get("format") == "factory-plan":
		_remember()
		_restore_plan(parsed)
	elif _load_dataset(parsed):
		_request.goals = []
		_positions.clear()
		_recalculate()


func _cancel() -> void:
	computation.cancel()
	%Cancel.disabled = true
	status.text = "Calculation cancelled. The current graph is preserved."


func _failed(message: String) -> void:
	if _job_kind == "preview_configuration":
		%GoalEditor.show_error(message)
		return
	%Feedback.error()
	%Cancel.disabled = true
	status.text = message
	status.tooltip_text = message
