class_name PlannerWorkspace
extends Control

signal layout_settled

@onready var graph: PlannerGraphCanvas = %Graph
@onready var layout_computation: PlannerComputation = %LayoutComputation
@onready var computation: PlannerComputation = %Computation
@onready var recipes_list: ItemList = %Recipes
@onready var search: LineEdit = %Search
@onready var rate: SpinBox = %Rate
@onready var inspector: RichTextLabel = %Inspector
@onready var inspector_cards: PlannerInspectorCards = %InspectorCards
@onready var status: Label = %Status
@onready var files: FileDialog = %Files

@export var recipe_scene: PackedScene
@export var group_scene: PackedScene
@export_file var default_dataset_path := "res://data/statech-2.0.1.json.gz"

var restore_saved_plan := true

var _dataset: Dictionary[String, Variant] = {}
var _dataset_storage_key := ""
var _request: Dictionary[String, Variant] = {"goals": [], "replication": false}
var _positions: Dictionary[String, Variant] = {}
var _recipes: Dictionary[String, Dictionary] = {}
var _resources: Dictionary[String, String] = {}
var _routes_by_resource: Dictionary[String, Array] = {}
var _inspected_key := ""
var _last_view := Vector3(INF, INF, INF)
var _last_view_key := ""
var _pending_view: Dictionary = {}
var _nodes: Dictionary[String, PlannerRecipeNode] = {}
var _graph_connections: Array[Dictionary] = []
var _graph_link_errors: Array[String] = []
var _undo: Array[Dictionary] = []
var _redo: Array[Dictionary] = []
var _selected := ""
var _last_result: Dictionary[String, Variant] = {}
var _file_action := "import"
var _job_kind := "solve"
var _rendering := false
var _initial_layout := false
var _layout_response: Dictionary = {}
var _layout_revision := 0
var _unplaced: Array[String] = []
var _groups: Dictionary[String, Dictionary] = {}
var _frames: Dictionary[String, GraphFrame] = {}
var _resizing_group := ""
var _members: Dictionary[String, String] = {}
var _world_import: Dictionary[String, Variant] = {}
var _json_import: FileAccess
var _json_import_characters := 0
var _json_import_total := 0
const JSON_IMPORT_PATH := "user://portable-import.pending"
var _recipe_matches: Array[String] = []
var _recipe_page := 0
const RECIPE_PAGE_SIZE := 150
var _choice_kind := ""
var _choice_resource := ""
var _choice_recipe := ""
var _choice_slot := -1
var _choice_candidates: Array[Dictionary] = []
var _pending_selected_recipe := ""


func _ready() -> void:
	if FileAccess.file_exists(JSON_IMPORT_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(JSON_IMPORT_PATH))
	OS.low_processor_usage_mode = true
	if "--capture" in OS.get_cmdline_user_args() || "--capture-existing" in OS.get_cmdline_user_args():
		OS.low_processor_usage_mode = false
	layout_computation.completed.connect(func(result: Dictionary) -> void: _layout_response = result)
	layout_computation.failed.connect(func(message: String) -> void: status.text = "Graph arrangement failed: " + message)
	computation.completed.connect(_calculated)
	computation.failed.connect(_failed)
	computation.progress.connect(func(message: String) -> void: status.text = message)
	search.text_changed.connect(_filter_recipes)
	PlannerDisplay.track_input(rate)
	recipes_list.item_selected.connect(func(_index: int) -> void: _refresh_route_action())
	%PreviousRecipes.pressed.connect(func() -> void: _recipe_page -= 1; _show_recipe_page())
	%NextRecipes.pressed.connect(func() -> void: _recipe_page += 1; _show_recipe_page())
	%AddGoal.pressed.connect(_add_goal)
	%PinRoute.pressed.connect(_pin_route)
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
	%Settings.pressed.connect(func() -> void: %FactorySettings.open_settings(_dataset, _request, _world_import))
	%Summary.pressed.connect(_show_power)
	inspector_cards.node_requested.connect(_jump_to_node)
	inspector_cards.route_requested.connect(_open_route_choice)
	inspector_cards.ingredient_requested.connect(_open_ingredient_choice)
	%ChoiceSearch.text_changed.connect(_filter_choices)
	%ChoiceList.item_selected.connect(func(_index: int) -> void: _refresh_choice_action())
	%ChoiceList.item_activated.connect(func(_index: int) -> void: _apply_choice())
	%ChoiceApply.pressed.connect(_apply_choice)
	%ChoiceCancel.pressed.connect(func() -> void: %ChoiceDialog.hide())
	%ChoiceDialog.close_requested.connect(func() -> void: %ChoiceDialog.hide())
	%ConnectionMode.item_selected.connect(func(_index: int) -> void: _refresh_connections(); _save_view())
	%FocusRecipe.pressed.connect(func() -> void: _focus_recipe(true))
	%FactorySettings.settings_changed.connect(func(request: Dictionary) -> void:
		_remember()
		_request.assign(request)
		_recalculate()
	)
	%GoalEditor.preview_requested.connect(_preview_goal)
	%GoalEditor.goal_changed.connect(_apply_goal)
	%GoalEditor.line_changed.connect(_apply_line_choice)
	%Arrange.pressed.connect(_arrange)
	%ExpandGraph.toggled.connect(_expand_graph)
	%AddGroup.pressed.connect(_add_group)
	%Import.pressed.connect(_choose_import)
	%NewPlan.pressed.connect(_start_new_plan)
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
	graph.add_theme_color_override("activity", Color("e8dfba"))
	graph.gui_input.connect(_graph_input)
	graph.end_node_move.connect(_save_positions)
	graph.begin_node_move.connect(_remember)
	graph.delete_nodes_request.connect(_delete_nodes)
	var example_requested := OS.get_cmdline_user_args().has("--example") || OS.get_cmdline_user_args().has("--capture")
	if OS.has_feature("web"):
		example_requested = bool(JavaScriptBridge.eval("new URLSearchParams(window.location.search).get('dataset') === 'example'"))
	var dataset_path := "res://data/example.json" if example_requested else default_dataset_path
	_capture_stage("Reading the bundled dataset")
	var dataset_bytes := FileAccess.get_file_as_bytes(dataset_path)
	if dataset_path.ends_with(".gz"):
		dataset_bytes = dataset_bytes.decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP)
	_capture_stage("Parsing %d dataset bytes" % dataset_bytes.size())
	var default_data: Variant = PlannerJson.parse(dataset_bytes.get_string_from_utf8())
	_capture_stage("Loading the parsed dataset")
	if dataset_bytes.is_empty() || !_load_dataset(default_data):
		_failed("The bundled dataset could not be read. Import a valid dataset to recover.")
	_request = _new_request()
	_capture_stage("The bundled dataset is ready")
	if restore_saved_plan && OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.restore()")
	elif restore_saved_plan && FileAccess.file_exists("user://autosave.json"):
		_capture_stage("Reading the saved plan")
		var saved: Variant = PlannerJson.parse(FileAccess.get_file_as_string("user://autosave.json"))
		_capture_stage("The saved plan parsed")
		if saved is Dictionary && !saved.has("dataset"):
			var reference: String = str(saved.get("dataset_ref", ""))
			if reference.length() == 64 && reference.is_valid_hex_number(false):
				var cached_path := "user://datasets/" + reference + ".json"
				if FileAccess.file_exists(cached_path):
					var cached := FileAccess.get_file_as_string(cached_path)
					if cached.sha256_text() == reference:
						saved.dataset = PlannerJson.parse(cached)
		if saved is Dictionary && FileAccess.file_exists("user://workspace-view.json"):
			var view: Variant = PlannerJson.parse(FileAccess.get_file_as_string("user://workspace-view.json"))
			if view is Dictionary && view.get("dataset_identity") == saved.get("dataset_identity") && PlannerDatasetValidation.check_view(view.get("view")).is_empty():
				saved.view = view.view
		_restore_plan(saved)
		_capture_stage("The saved plan was submitted")
	search.grab_focus.call_deferred()
	if _request.get("production_only", false) && _request.get("goals", []).is_empty():
		status.text = "Production preview: electricity is an external supply in Factory settings."
	if "--capture" in OS.get_cmdline_user_args():
		_request.goals = [{"resource": "motor", "rate": 2.0, "recipe": "assemble"}]
		_recalculate()
	if !OS.has_feature("web"):
		for argument: String in OS.get_cmdline_user_args():
			if argument.begins_with("--world="):
				_import_world(argument.trim_prefix("--world="))
				break


func _capture_stage(message: String) -> void:
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-result="):
			var path := argument.trim_prefix("--capture-result=") + ".stages"
			var output := FileAccess.open(path, FileAccess.READ_WRITE if FileAccess.file_exists(path) else FileAccess.WRITE)
			if output:
				output.seek_end()
				output.store_line("%d: %s" % [Time.get_ticks_msec(), message])
				output.close()


func _setup_focus() -> void:
	var controls: Array[Control] = [search, recipes_list, rate.get_line_edit(), %AddGoal, %PinRoute, %Replication, %ReducedMotion,
		%PreviousRecipes, %NextRecipes, %Arrange, %ExpandGraph, %AddGroup, %Settings, %Summary, %ConnectionMode, %FocusRecipe, graph, inspector, %EditGoal, %RemoveGoal, %ReviewWorld, %Import, %Save, %Undo, %Redo, %About, %Sounds, %Cancel]
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
		if %ExpandGraph.button_pressed:
			%ExpandGraph.button_pressed = false
			graph.accept_event()
			return
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
	if _json_import:
		_read_json_import_chunk()
		return
	var response: Variant = JavaScriptBridge.eval("window.plannerBridge.pollFile()")
	if !(response is String) || response.is_empty():
		return
	var event: Dictionary = PlannerJson.parse(response)
	match event.kind:
		"json":
			_import_json(event.value)
		"json_stream":
			_begin_json_import(int(event.characters))
		"world":
			_import_world("")
		"error":
			_failed(event.message)


func _begin_json_import(characters: int) -> void:
	if characters <= 0:
		_failed("The selected plan is empty.")
		return
	computation.cancel()
	_json_import = FileAccess.open(JSON_IMPORT_PATH, FileAccess.WRITE)
	if _json_import == null:
		JavaScriptBridge.eval("window.plannerBridge.cancelFileImport()")
		_failed("The portable plan could not be read. Check available browser storage.")
		return
	_json_import_characters = 0
	_json_import_total = characters
	status.text = "Reading portable plan…"
	%Cancel.text = "Cancel import"
	%Cancel.disabled = false


func _read_json_import_chunk() -> void:
	var response: Variant = JavaScriptBridge.eval("window.plannerBridge.readFileChunk()")
	if !(response is String) || response.is_empty():
		_stop_json_import()
		_failed("The portable plan ended before it was fully read.")
		return
	var piece: Variant = PlannerJson.parse(response)
	if !(piece is Dictionary) || !(piece.get("chunk") is String):
		_stop_json_import()
		_failed("The portable plan contains an unreadable part.")
		return
	_json_import.store_string(piece.chunk)
	_json_import_characters = int(piece.get("characters", 0))
	status.text = "Reading portable plan · %d%%…" % (
		100 * _json_import_characters / _json_import_total
	)
	if !piece.get("done", false):
		return
	_json_import.close()
	_json_import = null
	%Cancel.text = "Cancel calculation"
	%Cancel.disabled = true
	if _json_import_characters != _json_import_total:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(JSON_IMPORT_PATH))
		_failed("The portable plan ended before it was fully read.")
		return
	var parsed: Variant = PlannerJson.parse(FileAccess.get_file_as_string(JSON_IMPORT_PATH))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(JSON_IMPORT_PATH))
	_import_json(parsed)


func _stop_json_import() -> void:
	if _json_import:
		_json_import.close()
		_json_import = null
	JavaScriptBridge.eval("window.plannerBridge.cancelFileImport()")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(JSON_IMPORT_PATH))
	%Cancel.text = "Cancel calculation"
	%Cancel.disabled = true


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
	_dataset_storage_key = ""
	_recipes.clear()
	_resources.clear()
	_routes_by_resource.clear()
	for resource: Dictionary in _dataset.resources:
		_resources[resource.id] = PlannerDisplay.readable_name(resource.id, resource.get("name", ""))
	for recipe: Dictionary in _dataset.recipes:
		_recipes[recipe.id] = recipe
		for output: Dictionary in recipe.get("outputs", []):
			var resource: String = output.resource
			if !_routes_by_resource.has(resource):
				_routes_by_resource[resource] = []
			if !recipe.id in _routes_by_resource[resource]:
				_routes_by_resource[resource].append(recipe.id)
	%DatasetName.text = "%s · Preview" % _dataset.get("name", "Custom dataset") if !_dataset.get("complete", false) else str(_dataset.get("name", "Custom dataset"))
	_filter_recipes(search.text)
	return true


func _new_request() -> Dictionary[String, Variant]:
	if _dataset.get("identity") == "example:1":
		return {
			"goals": [], "replication": false, "production_only": true, "exact_production": true,
			"external": [{"resource": "energy:eu", "cost": 0}],
		}
	if _dataset.get("identity") == "statech-industry-2:2.0.1":
		var request: Dictionary[String, Variant] = {
			"goals": [], "replication": false, "production_only": true, "exact_production": true,
			"external": [{"resource": "energy:eu", "cost": 0}],
		}
		for stage: Dictionary in _dataset.get("progression", []):
			if stage.id == "statech:all":
				request.available_machines = stage.available_machines.duplicate()
				request.available_upgrades = stage.available_upgrades.duplicate()
				request.available_parts = stage.available_parts.duplicate()
				request.progression_preset = stage.id
				break
		return request
	return {"goals": [], "replication": false, "exact_production": true}


func _start_new_plan() -> void:
	var already_bundled: bool = _dataset.get("identity", "") == "statech-industry-2:2.0.1"
	var decoded: Variant = null
	if !already_bundled:
		var packed := FileAccess.get_file_as_bytes(default_dataset_path)
		if packed.is_empty():
			_failed("The bundled dataset could not be read.")
			return
		decoded = PlannerJson.parse(packed.decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
		if !PlannerDatasetValidation.check(decoded).is_empty():
			_failed("The bundled dataset is invalid.")
			return
	_remember()
	computation.cancel()
	_replace_graph_canvas()
	_frames.clear()
	if !already_bundled && !_load_dataset(decoded):
		return
	_request = _new_request()
	_positions.clear()
	_groups.clear()
	_world_import.clear()
	_pending_view.clear()
	_inspected_key = ""
	%ReviewWorld.disabled = true
	%Replication.set_pressed_no_signal(false)
	%ConnectionMode.select(0)
	_last_result = {"status": "feasible", "optimal": true, "lines": [], "connections": []}
	graph.minimap_enabled = false
	_render_plan(_last_result)
	graph.zoom = 1.0
	graph.scroll_offset = Vector2.ZERO
	_refresh_connections()
	%Summary.text = "No goals yet"
	status.text = "New plan ready."
	_autosave()


func _replace_graph_canvas() -> void:
	_cancel_layout()
	var previous := graph
	var replacement := PlannerGraphCanvas.new()
	replacement.name = previous.name
	replacement.layout_mode = previous.layout_mode
	replacement.size_flags_horizontal = previous.size_flags_horizontal
	replacement.size_flags_vertical = previous.size_flags_vertical
	replacement.custom_minimum_size = previous.custom_minimum_size
	replacement.theme = previous.theme
	replacement.show_arrange_button = previous.show_arrange_button
	replacement.show_grid_buttons = previous.show_grid_buttons
	replacement.show_grid = previous.show_grid
	replacement.show_zoom_label = previous.show_zoom_label
	replacement.minimap_size = previous.minimap_size
	replacement.minimap_opacity = previous.minimap_opacity
	replacement.connection_lines_thickness = previous.connection_lines_thickness
	replacement.connection_lines_curvature = previous.connection_lines_curvature
	replacement.zoom_min = previous.zoom_min
	replacement.zoom_max = previous.zoom_max
	replacement.snapping_distance = previous.snapping_distance
	replacement.panning_scheme = previous.panning_scheme
	var parent := previous.get_parent()
	var child_index := previous.get_index()
	previous.unique_name_in_owner = false
	parent.remove_child(previous)
	previous.queue_free()
	parent.add_child(replacement)
	parent.move_child(replacement, child_index)
	replacement.owner = self
	replacement.unique_name_in_owner = true
	graph = replacement
	graph.node_selected.connect(_select_node)
	graph.gui_input.connect(_graph_input)
	graph.end_node_move.connect(_save_positions)
	graph.begin_node_move.connect(_remember)
	graph.delete_nodes_request.connect(_delete_nodes)
	graph.add_theme_color_override("activity", Color("e8dfba"))
	_nodes.clear()
	_frames.clear()
	_members.clear()
	_graph_connections.clear()


func _filter_recipes(query: String) -> void:
	_recipe_matches.clear()
	_recipe_page = 0
	var normalized := query.to_lower()
	for recipe: Dictionary in _dataset.get("recipes", []):
		var title: String = PlannerDisplay.recipe_list_name(recipe)
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
		var title: String = PlannerDisplay.recipe_list_name(recipe)
		var index := recipes_list.add_item(title)
		recipes_list.set_item_metadata(index, recipe.id)
		recipes_list.set_item_tooltip(index, "%s\n%s" % [title, recipe.get("unsupported", recipe.id)])
	%RecipePage.text = "%d–%d / %d" % [first + 1 if last > first else 0, last, _recipe_matches.size()]
	%PreviousRecipes.disabled = first == 0
	%NextRecipes.disabled = last >= _recipe_matches.size()
	if recipes_list.item_count:
		recipes_list.select(0)
	_refresh_route_action()


func _refresh_route_action() -> void:
	var routes: Dictionary = _request.get("routes", {})
	for index: int in recipes_list.item_count:
		var id: String = recipes_list.get_item_metadata(index)
		var recipe: Dictionary = _recipes[id]
		var pinned: bool = routes.get(recipe.primary) == id
		recipes_list.set_item_text(index, ("✓ " if pinned else "") + PlannerDisplay.recipe_list_name(recipe))
	var selected := recipes_list.get_selected_items()
	if selected.is_empty():
		%PinRoute.disabled = true
		%PinRoute.text = "Pin route"
		return
	var id: String = recipes_list.get_item_metadata(selected[0])
	var recipe: Dictionary = _recipes[id]
	var pinned: bool = routes.get(recipe.primary) == id
	%PinRoute.text = "Clear route" if pinned else "Pin route"
	%PinRoute.disabled = recipe.has("unsupported") && !pinned
	%PinRoute.tooltip_text = ("Let the planner choose the route for this resource." if pinned else
		"Use this recipe to supply its main output. This does not add a goal.")


func _add_goal() -> void:
	var indices := recipes_list.get_selected_items()
	if indices.is_empty():
		return
	_remember()
	var id: String = recipes_list.get_item_metadata(indices[0])
	var recipe: Dictionary = _recipes[id]
	var existing := false
	for goal: Dictionary in _request.goals:
		if goal.get("recipe") == id && goal.get("kind", "rate") == "rate" && !goal.has("rate_ratio"):
			goal.rate += PlannerDisplay.input_value(rate)
			existing = true
	if !existing:
		_request.goals.append({"resource": recipe.primary, "rate": PlannerDisplay.input_value(rate), "recipe": id})
	_recalculate()


func _pin_route() -> void:
	var indices := recipes_list.get_selected_items()
	if indices.is_empty():
		return
	var id: String = recipes_list.get_item_metadata(indices[0])
	var recipe: Dictionary = _recipes[id]
	var pinned: bool = _request.get("routes", {}).get(recipe.primary) == id
	if recipe.has("unsupported") && !pinned:
		_failed("This route is unavailable: " + str(recipe.unsupported))
		return
	_remember()
	if !_request.has("routes"):
		_request.routes = {}
	if pinned:
		_request.routes.erase(recipe.primary)
	else:
		_request.routes[recipe.primary] = id
	_refresh_route_action()
	_recalculate()
	if pinned:
		status.text = "Cleared the route choice for %s." % _resources.get(recipe.primary, recipe.primary)
	else:
		status.text = "Pinned %s as the route for %s without adding a goal." % [
			PlannerDisplay.recipe_name(recipe), _resources.get(recipe.primary, recipe.primary)]


func _open_route_choice(resource: String) -> void:
	_choice_kind = "route"
	_choice_resource = resource
	_choice_recipe = ""
	_choice_slot = -1
	_choice_candidates = [{"id": "", "name": "Automatic choice", "reason": ""}]
	var active := ""
	for route: Dictionary in _last_result.get("primary_routes", []):
		if route.resource == resource:
			active = route.recipe
			break
	for id: String in _routes_by_resource.get(resource, []):
		var recipe: Dictionary = _recipes[id]
		var inputs: Array[String] = []
		for flow: Dictionary in recipe.get("inputs", []).slice(0, 2):
			inputs.append(_resources.get(flow.get("resource", ""), "Alternative inputs" if flow.has("choices") else "Unknown input"))
		var label: String = PlannerDisplay.recipe_list_name(recipe)
		if !inputs.is_empty():
			label += " · " + ", ".join(inputs)
		if id == active:
			label = "Current · " + label
		_choice_candidates.append({"id": id, "name": label, "reason": _recipe_unavailable_reason(recipe)})
	_open_choice_dialog("Source for " + _resources.get(resource, PlannerDisplay.readable_name(resource)),
		"Choose a recipe that supplies this resource. Automatic removes your pin.")


func _open_ingredient_choice(recipe_id: String, slot: int) -> void:
	var selected_line: Dictionary = _inspected_line()
	if selected_line.is_empty() || selected_line.recipe != recipe_id:
		return
	var flows := _ingredient_flows(selected_line, _recipes[recipe_id])
	if slot < 0 || slot >= flows.size():
		return
	var flow: Dictionary = flows[slot]
	_choice_kind = "ingredient"
	_choice_recipe = recipe_id
	_choice_slot = slot
	_choice_resource = ""
	_choice_candidates = [{"id": "", "name": "Automatic choice", "reason": ""}]
	for resource: String in flow.get("choices", []):
		_choice_candidates.append({"id": resource,
			"name": _resources.get(resource, PlannerDisplay.readable_name(resource)), "reason": ""})
	_open_choice_dialog("Ingredient · slot %d" % (slot + 1),
		"Choose one resource for this recipe slot. Automatic removes your pin.")


func _open_choice_dialog(title: String, note: String) -> void:
	%ChoiceDialog.title = title
	%ChoiceNote.text = note
	%ChoiceSearch.text = ""
	_filter_choices("")
	var viewport_size: Vector2 = get_viewport_rect().size
	var dialog_size := Vector2i(mini(700, maxi(440, int(viewport_size.x) - 64)), mini(590, maxi(350, int(viewport_size.y) - 64)))
	%ChoiceDialog.popup_centered(dialog_size)
	%ChoiceSearch.grab_focus.call_deferred()


func _filter_choices(query: String) -> void:
	%ChoiceList.clear()
	var normalized := query.strip_edges().to_lower()
	var selected_id := ""
	if _choice_kind == "route":
		selected_id = _request.get("routes", {}).get(_choice_resource, "")
	elif _choice_kind == "ingredient":
		selected_id = _request.get("ingredients", {}).get("%s#%d" % [_choice_recipe, _choice_slot], "")
	var selected_index := -1
	for candidate: Dictionary in _choice_candidates:
		if !normalized.is_empty() && !normalized in str(candidate.name).to_lower() && !normalized in str(candidate.id).to_lower():
			continue
		var index: int = %ChoiceList.add_item(str(candidate.name))
		%ChoiceList.set_item_metadata(index, candidate.id)
		%ChoiceList.set_item_tooltip(index, str(candidate.reason) if !str(candidate.reason).is_empty() else str(candidate.id))
		%ChoiceList.set_item_disabled(index, !str(candidate.reason).is_empty())
		if candidate.id == selected_id:
			selected_index = index
	if selected_index >= 0 && !%ChoiceList.is_item_disabled(selected_index):
		%ChoiceList.select(selected_index)
	_refresh_choice_action()


func _refresh_choice_action() -> void:
	var selected: PackedInt32Array = %ChoiceList.get_selected_items()
	%ChoiceApply.disabled = selected.is_empty() || %ChoiceList.is_item_disabled(selected[0])


func _apply_choice() -> void:
	var selected: PackedInt32Array = %ChoiceList.get_selected_items()
	if selected.is_empty() || %ChoiceList.is_item_disabled(selected[0]):
		return
	var id: String = %ChoiceList.get_item_metadata(selected[0])
	if _choice_kind == "route":
		if !id.is_empty() && !_recipes.has(id):
			return
		for goal: Dictionary in _request.get("goals", []):
			if goal.resource == _choice_resource && goal.get("kind", "rate") == "capacity" && !id.is_empty() && id != goal.recipe:
				_failed("Edit this capacity goal before changing its recipe.")
				return
		_remember()
		if !_request.has("routes"):
			_request.routes = {}
		if id.is_empty():
			_request.routes.erase(_choice_resource)
		else:
			_request.routes[_choice_resource] = id
		for goal: Dictionary in _request.get("goals", []):
			if goal.resource == _choice_resource && goal.get("kind", "rate") != "capacity":
				if id.is_empty():
					goal.erase("recipe")
				else:
					goal.recipe = id
		_pending_selected_recipe = id
	elif _choice_kind == "ingredient":
		_remember()
		if !_request.has("ingredients"):
			_request.ingredients = {}
		var key := "%s#%d" % [_choice_recipe, _choice_slot]
		if id.is_empty():
			_request.ingredients.erase(key)
		else:
			_request.ingredients[key] = id
	%ChoiceDialog.hide()
	_recalculate()


func _recipe_unavailable_reason(recipe: Dictionary) -> String:
	if recipe.has("unsupported"):
		return str(recipe.unsupported)
	if recipe.get("replication", false) && !_request.get("replication", false):
		return "Enable replication to use this route."
	if recipe.id in _request.get("disabled_recipes", []):
		return "This recipe is disabled in Settings."
	for resource: String in recipe.get("requires_obtained", []):
		if !resource in _request.get("obtained_resources", []):
			return "Requires an obtained resource: " + _resources.get(resource, PlannerDisplay.readable_name(resource))
	var available: Variant = _request.get("available_machines", _dataset.get("default_machines", null))
	var disabled: Array = _request.get("disabled_machines", [])
	var supported := false
	if recipe.has("process"):
		for machine: Dictionary in _dataset.get("machines", []):
			if machine.get("status", "supported") != "supported" || machine.id in disabled:
				continue
			if available != null && !machine.id in available:
				continue
			if machine.get("recipe_type", "") == recipe.process.type:
				supported = true
				break
			if machine.get("mechanic", "") == "mi_array":
				for contained: String in machine.get("eligible_machines", []):
					if (machine.get("contained_recipe_types", {}).get(contained, "") == recipe.process.type &&
						!contained in disabled && (available == null || contained in available)):
						supported = true
						break
			if supported:
				break
	else:
		supported = recipe.get("configurations", []).any(func(configuration: Dictionary) -> bool:
			return !configuration.machine in disabled && (available == null || configuration.machine in available))
	if !supported:
		return "No available machine supports this route."
	return ""


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
		if _recipes[_selected].get("type") == "planner:solar_generation":
			%FactorySettings.open_settings(_dataset, _request, _world_import)
			%FactorySettings.get_node("%SettingsCategory").select(9)
			%FactorySettings._category_changed(9)
			%FactorySettings._filter(_selected)
		else:
			var selected_line: Dictionary = {}
			for node: PlannerRecipeNode in _nodes.values():
				if node.get_meta("position_key") == _inspected_key:
					selected_line = node.allocation
					break
			if selected_line.is_empty() || _request.goals.any(func(goal: Dictionary) -> bool:
				return goal.get("recipe") == _selected):
				%GoalEditor.open_goal(_recipes[_selected], _dataset, _request)
			else:
				%GoalEditor.open_line(_recipes[_selected], _dataset, _request, selected_line)


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


func _apply_line_choice(recipe: String, resource: String, selection: Dictionary, pin: bool) -> void:
	_remember()
	if !_request.has("routes"):
		_request.routes = {}
	if !_request.has("configurations"):
		_request.configurations = {}
	if pin:
		_request.routes[resource] = recipe
		_request.configurations[recipe] = selection.configuration
		if selection.has("setup"):
			if !_request.has("machine_setups"):
				_request.machine_setups = {}
			if !_request.machine_setups.has(recipe):
				_request.machine_setups[recipe] = []
			var setup: Dictionary = {"machine": selection.machine, "setup": selection.setup,
				"configuration": selection.configuration}
			if !setup in _request.machine_setups[recipe]:
				_request.machine_setups[recipe].append(setup)
	else:
		if _request.routes.get(resource) == recipe:
			_request.routes.erase(resource)
		_request.configurations.erase(recipe)
	_recalculate()


func _replication_changed(enabled: bool) -> void:
	_remember()
	_request.replication = enabled
	_recalculate()


func _recalculate() -> void:
	_cancel_layout()
	_job_kind = "solve"
	_refresh_route_action()
	%Cancel.disabled = false
	var request := _request.duplicate(true)
	computation.submit({"dataset": _dataset, "request": request})


func _capture_result(result: Dictionary) -> void:
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-result="):
			var output := FileAccess.open(argument.trim_prefix("--capture-result="), FileAccess.WRITE)
			if output:
				output.store_string(JSON.stringify(result, "", true, true))
				output.close()


func _calculated(result: Dictionary) -> void:
	_capture_result(result)
	%Cancel.disabled = true
	if _job_kind == "preview_configuration":
		%GoalEditor.show_preview(result)
		status.text = ("Configuration preview updated. Apply the line choice to recalculate support."
			if %GoalEditor._line_only else
			"Configuration preview updated. Apply the goal to recalculate its support.")
		return
	if _job_kind in ["import_world", "correct_world"]:
		var previous_solar: Array = _world_import.get("reconstruction", {}).get("solar_panels", []).duplicate(true)
		var apply_empty: bool = _job_kind == "correct_world" && !_world_import.get("reconstruction", {}).get("goals", []).is_empty()
		var replace_infrastructure: bool = !result.get("reconstruction", {}).get("infrastructure", []).is_empty() || (_job_kind == "correct_world" && !_world_import.get("reconstruction", {}).get("infrastructure", []).is_empty())
		var replace_storage: bool = !result.get("reconstruction", {}).get("storage_units", []).is_empty() || (_job_kind == "correct_world" && !_world_import.get("reconstruction", {}).get("storage_units", []).is_empty())
		var replace_solar: bool = !result.get("reconstruction", {}).get("solar_panels", []).is_empty() || !previous_solar.is_empty()
		_remember()
		_world_import.assign(result)
		%ReviewWorld.disabled = false
		var reconstruction: Dictionary = result.get("reconstruction", {})
		var goals: Array = reconstruction.get("goals", [])
		if replace_solar:
			_preserve_solar_positions(previous_solar, reconstruction.get("solar_panels", []))
		if replace_infrastructure:
			_request.infrastructure = reconstruction.get("infrastructure", []).duplicate(true)
		if replace_storage:
			var installed: Dictionary = {}
			for unit: Dictionary in reconstruction.get("storage_units", []):
				if unit.get("enabled", true):
					installed[unit.machine_id] = int(installed.get(unit.machine_id, 0)) + 1
			_request.periodic_storage = installed.keys()
			_request.periodic_storage_installed = installed
			_request.periodic_storage_limits = {}
			var available_storage: Array = _request.get("available_machines", _dataset.get("default_machines", [])).duplicate()
			for id: String in installed:
				if !id in available_storage:
					available_storage.append(id)
			_request.available_machines = available_storage
		if replace_solar:
			var installed_solar: Dictionary = _request.get("installed", {}).duplicate(true)
			for panel: Dictionary in previous_solar:
				installed_solar.erase(panel.configuration)
			for panel: Dictionary in reconstruction.get("solar_panels", []):
				installed_solar[panel.configuration] = int(installed_solar.get(panel.configuration, 0)) + 1
			_request.installed = installed_solar
			var available_solar: Array = _request.get("available_machines", _dataset.get("default_machines", [])).duplicate()
			for panel: Dictionary in reconstruction.get("solar_panels", []):
				if !panel.machine_id in available_solar:
					available_solar.append(panel.machine_id)
			_request.available_machines = available_solar
			if !reconstruction.get("solar_panels", []).is_empty() && _request.get("periodic_storage", []).is_empty():
				var peak := 0.0
				for panel: Dictionary in reconstruction.solar_panels:
					for recipe: Dictionary in _dataset.get("recipes", []):
						if recipe.id == panel.recipe:
							var profile: Dictionary = recipe.configurations[0].periodic_generation
							var panel_peak := 0.0
							for segment: Dictionary in profile.segments:
								panel_peak = maxf(panel_peak, float(segment.eu_per_tick))
							peak += panel_peak
							break
				var tiers: Array[Dictionary] = []
				for machine: Dictionary in _dataset.get("machines", []):
					if machine.get("mechanic") == "energy_storage" && machine.get("status") == "infrastructure":
						tiers.append(machine)
				tiers.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.storage.discharge_eu_per_tick < b.storage.discharge_eu_per_tick)
				if !tiers.is_empty():
					var chosen: Dictionary = tiers[-1]
					for tier: Dictionary in tiers:
						if tier.storage.discharge_eu_per_tick >= peak:
							chosen = tier
							break
					_request.periodic_storage = [chosen.id]
					if !chosen.id in _request.available_machines:
						_request.available_machines.append(chosen.id)
					_world_import["inferred_solar_storage"] = chosen.id
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
		%Notice.title = "World import"
		%Notice.dialog_text = "Read %d machines and %d pattern providers.\n%d capacity goals; %d solar panels; %d storage units; %d infrastructure configurations; %d assignments need correction.\n%d unsupported entries; %d read errors.\n\nUse Imported factory to review assignments and end goals. Stored quantities are not production rates." % [result.machines.size(), result.providers.size(), goals.size(), reconstruction.get("solar_panels", []).size(), reconstruction.get("storage_units", []).size(), reconstruction.get("infrastructure", []).size(), reconstruction.get("unresolved", []).size(), result.unsupported.size(), result.errors.size()]
		%Notice.popup_centered()
		status.text = "World configuration read locally."
		if !goals.is_empty() || apply_empty || replace_infrastructure || replace_storage || replace_solar:
			_recalculate()
		return
	if result.get("status") not in ["optimal", "feasible"]:
		_pending_selected_recipe = ""
		if result.get("status") == "numerical_error":
			_failed("The requested precision could not be verified. The previous graph is preserved.")
			%Notice.title = "Calculation precision"
			%Notice.dialog_text = "The calculation could not verify every flow at the requested precision. It has not replaced your plan.\n\n" + String(result.get("reason", "A numerical balance check failed."))
			%Notice.popup_centered()
			return
		_failed("No feasible plan. Check unlocks, routes, and supplies.")
		status.tooltip_text = str(result.get("reason", result.get("status", "unknown")))
		return
	_last_result.assign(result)
	_render_plan(result)
	status.text = "Plan ready." if result.get("optimal", false) else "Plan ready · Cost unproven."
	if !_graph_link_errors.is_empty():
		status.text = "%d graph flows could not be drawn. Select Plan details for the calculation." % _graph_link_errors.size()
		status.tooltip_text = "\n".join(_graph_link_errors)
	elif !result.get("flow_roundoff_links", []).is_empty():
		status.text = "%d inputs remain unallocated. Inspect the red graph nodes." % result.flow_roundoff_links.size()
		status.tooltip_text = "These small balance gaps were not counted as supplies. Select an Unallocated demand node for its resource and amount."
	else:
		status.tooltip_text = "Open Plan details to inspect the search result, cost bound, and power balance."
	_autosave()
	if "--capture" in OS.get_cmdline_user_args() || "--capture-existing" in OS.get_cmdline_user_args():
		await layout_settled
		await get_tree().create_timer(0.5).timeout
		await RenderingServer.frame_post_draw
		var capture_path := "res://.plans/artifacts/workspace/first.png"
		for argument: String in OS.get_cmdline_user_args():
			if argument.begins_with("--capture-path="):
				capture_path = argument.trim_prefix("--capture-path=")
		get_viewport().get_texture().get_image().save_png(capture_path)
		get_tree().quit()


func _preserve_solar_positions(previous: Array, current: Array) -> void:
	var current_routes: Dictionary = {}
	for panel: Dictionary in current:
		current_routes[panel.configuration] = true
	for old: Dictionary in previous:
		if current_routes.has(old.configuration):
			continue
		for panel: Dictionary in current:
			if panel.machine != old.machine:
				continue
			var old_key: String = "%s|%s" % [old.recipe, old.configuration]
			var new_key: String = "%s|%s" % [panel.recipe, panel.configuration]
			if _positions.has(old_key) && !_positions.has(new_key):
				_positions[new_key] = _positions[old_key]
				_positions.erase(old_key)
				if _inspected_key == old_key:
					_inspected_key = new_key
			break


func _storage_units_for_graph(result: Dictionary) -> Array[Dictionary]:
	var observed: Dictionary = {}
	for saved: Dictionary in _world_import.get("reconstruction", {}).get("storage_units", []):
		var id: String = saved.machine_id
		if !saved.get("enabled", true) || !id in _request.get("periodic_storage", []):
			continue
		if !observed.has(id):
			observed[id] = {"count": 0, "saved_charge_eu": 0, "origins": []}
		var record: Dictionary = observed[id]
		record.count += 1
		record.saved_charge_eu += int(saved.saved_charge_eu)
		record.origins.append(saved.origin)
	var display: Array[Dictionary] = []
	var solved: Dictionary = {}
	for unit: Dictionary in result.get("periodic_power", {}).get("storage", []):
		if unit.machines <= 0:
			continue
		var item: Dictionary = unit.duplicate(true)
		if observed.has(unit.machine):
			item.imported_count = observed[unit.machine].count
			item.imported_saved_charge_eu = str(observed[unit.machine].saved_charge_eu)
			item.imported_origins = observed[unit.machine].origins
		display.append(item)
		solved[unit.machine] = true
	for id: String in observed:
		if solved.has(id):
			continue
		var machine: Dictionary = {}
		for candidate: Dictionary in _dataset.get("machines", []):
			if candidate.id == id:
				machine = candidate
				break
		if machine.is_empty():
			continue
		var count: int = int(_request.get("periodic_storage_installed", {}).get(id, observed[id].count))
		if count <= 0:
			continue
		var rule: Dictionary = machine.storage
		display.append({"machine": id, "machines": count, "capacity_eu": rule.capacity_eu * count,
			"charge_eu_per_tick": rule.charge_eu_per_tick * count,
			"discharge_eu_per_tick": rule.discharge_eu_per_tick * count,
			"imported_count": observed[id].count,
			"imported_saved_charge_eu": str(observed[id].saved_charge_eu),
			"imported_origins": observed[id].origins})
	return display


func _render_plan(result: Dictionary) -> void:
	_layout_revision += 1
	layout_computation.cancel()
	%Arrange.disabled = false
	var graph_data: Dictionary = PlannerGraphEndpoints.local_power(PlannerGraphEndpoints.build(result))
	_graph_connections.assign(graph_data.connections)
	var storage_display: Array[Dictionary] = _storage_units_for_graph(result)
	var layout_lines: Array = result.lines.duplicate()
	for unit: Dictionary in storage_display:
		if unit.machines > 0:
			var key: String = "planner:storage|" + str(unit.machine)
			layout_lines.append({"recipe": key, "configuration": key, "machine": unit.machine})
	_reuse_allocation_positions(layout_lines)
	_initial_layout = _positions.is_empty() && _groups.is_empty()
	if _initial_layout && _pending_view.is_empty():
		%ConnectionMode.select(1)
		graph.minimap_enabled = result.lines.size() > 30
	_unplaced.clear()
	_rendering = true
	graph.clear_connections()
	for frame: GraphFrame in _frames.values():
		frame.free()
	_frames.clear()
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
		var imported_panels: Array[Dictionary] = []
		for panel: Dictionary in _world_import.get("reconstruction", {}).get("solar_panels", []):
			if panel.configuration == line.configuration:
				imported_panels.append(panel)
		if !imported_panels.is_empty():
			node.set_meta("solar_panels", imported_panels)
		var key := String(line.recipe) + "|" + String(line.configuration)
		node.set_meta("position_key", key)
		if !_positions.has(key):
			_unplaced.append(key)
		var saved: Array = _positions.get(key, [45 + (index % 2) * 355, 75 + (index / 2) * 300])
		node.position_offset = Vector2(saved[0], saved[1])
		_nodes[String(node.name)] = node
		machine_count += int(line.machines)
	for unit: Dictionary in storage_display:
		if unit.machines <= 0:
			continue
		var node := recipe_scene.instantiate() as PlannerRecipeNode
		node.name = "storage_%d" % _nodes.size()
		graph.add_child(node)
		node.configure_storage(unit, _resources)
		node.set_meta("storage_unit", unit)
		var key: String = node.recipe_id + "|" + node.recipe_id
		node.set_meta("position_key", key)
		if !_positions.has(key):
			_unplaced.append(key)
		var saved: Array = _positions.get(key, [45 + (_nodes.size() % 2) * 355, 75 + (_nodes.size() / 2) * 300])
		node.position_offset = Vector2(saved[0], saved[1])
		_nodes[String(node.name)] = node
		machine_count += int(unit.machines)
	for endpoint: Dictionary in graph_data.nodes:
		var node := recipe_scene.instantiate() as PlannerRecipeNode
		node.name = "endpoint_%d" % _nodes.size()
		graph.add_child(node)
		node.configure_endpoint(endpoint, _resources)
		node.set_meta("flow_endpoint", endpoint)
		node.set_meta("position_key", endpoint.key)
		if !_positions.has(endpoint.key):
			_unplaced.append(endpoint.key)
		var saved: Array = _positions.get(endpoint.key, [45, 75])
		node.position_offset = Vector2(saved[0], saved[1])
		_nodes[String(node.name)] = node
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
	%Summary.text = "%d %s · Details" % [machine_count, "machine" if machine_count == 1 else "machines"]
	_rendering = false
	_restore_groups()
	_settle_node_sizes.call_deferred()
	if _initial_layout:
		graph.modulate.a = 0.0
	elif !%ReducedMotion.button_pressed:
		var tween := create_tween()
		tween.tween_property(graph, "modulate:a", 1.0, 0.18).from(0.5)
	if !_nodes.is_empty():
		var preferred: PlannerRecipeNode = by_key.get(_inspected_key)
		if !_pending_selected_recipe.is_empty():
			for node: PlannerRecipeNode in _nodes.values():
				if node.recipe_id == _pending_selected_recipe:
					preferred = node
					break
		_pending_selected_recipe = ""
		if !preferred:
			for node: PlannerRecipeNode in _nodes.values():
				if _request.goals.any(func(goal: Dictionary) -> bool: return goal.get("recipe") == node.recipe_id):
					preferred = node
					break
		_select_node(preferred if preferred else _nodes.values()[0])
	else:
		_selected = ""
		inspector.visible = true
		inspector_cards.visible = false
		inspector.text = "Select a recipe and add a goal to start planning."
		%RemoveGoal.disabled = true
		%EditGoal.disabled = true


func _reuse_allocation_positions(lines: Array) -> void:
	var next_keys: Dictionary[String, bool] = {}
	var replacements: Array[Dictionary] = []
	for line: Dictionary in lines:
		var key := String(line.recipe) + "|" + String(line.configuration)
		next_keys[key] = true
		if !_positions.has(key):
			replacements.append({"key": key, "recipe": line.recipe, "machine": line.machine})
	replacements.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.key < b.key)
	var previous: Array = _nodes.values()
	previous.sort_custom(func(a: PlannerRecipeNode, b: PlannerRecipeNode) -> bool: return String(a.get_meta("position_key")) < String(b.get_meta("position_key")))
	for node: PlannerRecipeNode in previous:
		var old_key: String = node.get_meta("position_key")
		if next_keys.has(old_key) || !_positions.has(old_key):
			continue
		var chosen := -1
		for index: int in replacements.size():
			var candidate: Dictionary = replacements[index]
			if candidate.recipe != node.recipe_id:
				continue
			if chosen == -1 || candidate.machine == node.allocation.machine:
				chosen = index
			if candidate.machine == node.allocation.machine:
				break
		if chosen == -1:
			continue
		var replacement: String = replacements[chosen].key
		_positions[replacement] = _positions[old_key]
		_positions.erase(old_key)
		if _inspected_key == old_key:
			_inspected_key = replacement
		replacements.remove_at(chosen)


func _settle_node_sizes() -> void:
	# Wrapped labels need their assigned width before GraphNode can discard its initial height estimate.
	await get_tree().process_frame
	for node: PlannerRecipeNode in _nodes.values():
		node.reset_size()
	if _initial_layout && !_nodes.is_empty():
		_initial_layout = false
		await _apply_layout(false)
		graph.modulate.a = 1.0
		if !%ReducedMotion.button_pressed:
			var tween := create_tween()
			tween.tween_property(graph, "modulate:a", 1.0, 0.18).from(0.5)
		if !_inspected_key.is_empty():
			_focus_recipe(false)
	elif !_unplaced.is_empty():
		_place_new_nodes()
		await _reroute_graph()
	graph.prepare_routes(_nodes)
	if !_pending_view.is_empty():
		graph.zoom = clampf(float(_pending_view.zoom), graph.zoom_min, graph.zoom_max)
		graph.scroll_offset = Vector2(_pending_view.scroll[0], _pending_view.scroll[1])
		_pending_view.clear()
	_update_membership()
	layout_settled.emit()


func _select_node(node: Node) -> void:
	inspector.visible = true
	inspector_cards.visible = false
	if node is GraphFrame:
		_highlight_neighbors("")
		%EditGoal.disabled = false
		%EditGoal.text = "Rename group"
		_selected = String(node.name)
		inspector.visible = false
		inspector_cards.visible = true
		inspector_cards.show_group(node.title, _members.values().count(String(node.name)))
		%RemoveGoal.text = "Remove group"
		%RemoveGoal.disabled = false
		return
	if !(node is PlannerRecipeNode):
		return
	if node.has_meta("flow_endpoint"):
		var endpoint: Dictionary = node.get_meta("flow_endpoint")
		_selected = ""
		_inspected_key = endpoint.key
		_highlight_neighbors(_inspected_key)
		_refresh_connections()
		node.selected = true
		%EditGoal.disabled = true
		%RemoveGoal.disabled = true
		inspector.visible = false
		inspector_cards.visible = true
		inspector_cards.show_endpoint(endpoint, _resources)
		return
	if node.has_meta("storage_unit"):
		var unit: Dictionary = node.get_meta("storage_unit")
		_selected = ""
		_inspected_key = node.get_meta("position_key")
		_highlight_neighbors(_inspected_key)
		_refresh_connections()
		node.selected = true
		%EditGoal.disabled = true
		%RemoveGoal.disabled = true
		inspector.text = "[font_size=20]%s[/font_size]\n\n[b]%d whole %s[/b]\n%s EU total capacity\n%s EU/t charge limit\n%s EU/t discharge limit" % [PlannerDisplay.markup(PlannerDisplay.machine_name(unit.machine, _resources)), int(unit.machines), "unit" if int(unit.machines) == 1 else "units", PlannerDisplay.number(unit.capacity_eu), PlannerDisplay.number(unit.charge_eu_per_tick), PlannerDisplay.number(unit.discharge_eu_per_tick)]
		if unit.has("initial_charge_eu"):
			inspector.text += "\n%s EU planned initial charge\n%s EU at the cycle end\n\nThis valid dispatch may use more than the minimum initial charge. The factory's generation and fuel chains sustain the repeated cycle." % [PlannerDisplay.number(unit.initial_charge_eu), PlannerDisplay.number(unit.ending_charge_eu)]
		else:
			inspector.text += "\n\nNo generation or production goal currently sizes this storage for periodic dispatch."
		if unit.has("imported_saved_charge_eu"):
			inspector.text += "\n\n[b]World snapshot[/b]\n%d saved %s with %s EU total charge when imported. This is a starting quantity, not sustained generation." % [int(unit.imported_count), "unit" if int(unit.imported_count) == 1 else "units", unit.imported_saved_charge_eu]
			for origin: Dictionary in unit.get("imported_origins", []):
				inspector.text += "\n%s · %d, %d, %d" % [PlannerDisplay.markup(str(origin.dimension)), origin.x, origin.y, origin.z]
			if unit.has("initial_charge_eu") && float(unit.imported_saved_charge_eu) < float(unit.initial_charge_eu):
				inspector.text += "\nThe saved charge is below the planned initial charge. Charge the units before relying on continuous operation."
		inspector.text += "\n\nCable reach and network sharing need to match the player's build."
		inspector.get_v_scroll_bar().set_deferred("value", 0.0)
		return
	var is_goal: bool = _request.goals.any(func(goal: Dictionary) -> bool:
		return goal.get("recipe") == node.recipe_id)
	%EditGoal.text = "Edit power source" if _recipes[node.recipe_id].get("type") == "planner:solar_generation" else (
		"Edit production goal" if is_goal else "Configure production line")
	_selected = node.recipe_id
	_inspected_key = node.get_meta("position_key")
	_highlight_neighbors(_inspected_key)
	_refresh_connections()
	node.selected = true
	%EditGoal.disabled = false
	var line: Dictionary = node.allocation
	inspector.text = PlannerDisplay.inspection(line, _recipes[line.recipe], _resources, _last_result.get("startup", {}), _last_result.get("construction", {}))
	inspector.visible = false
	inspector_cards.visible = true
	inspector_cards.show_line(line, _recipes[line.recipe], _resources, _last_result.get("startup", {}),
		_last_result.get("construction", {}), _inspector_context(node))
	if node.has_meta("solar_panels"):
		inspector.visible = true
		inspector_cards.visible = false
		var panels: Array = node.get_meta("solar_panels")
		inspector.text += "\n\n[b]World snapshot[/b]\n%d saved %s with this route. A stored cell or fluid amount does not establish sustained supply." % [panels.size(), "panel" if panels.size() == 1 else "panels"]
		for panel: Dictionary in panels:
			var saved_cell: Dictionary = panel.saved_cell if panel.saved_cell != null else {}
			var saved_fluid: Dictionary = panel.saved_fluid if panel.saved_fluid != null else {}
			inspector.text += "\n%s · %d, %d, %d · %s cell; %s mB fluid" % [PlannerDisplay.markup(str(panel.origin.dimension)), panel.origin.x, panel.origin.y, panel.origin.z, saved_cell.get("amount", "no saved"), saved_fluid.get("amount_mb", "0")]
			if panel.get("other_saved_item") != null:
				inspector.text += " · other saved item: %s × %s" % [panel.other_saved_item.amount, PlannerDisplay.markup(PlannerDisplay.readable_name(panel.other_saved_item.resource))]
			if panel.get("cell_evidence") == "player_supply_confirmation":
				inspector.text += " · matching cell supply confirmed by player"
		inspector.text += "\nClear weather, open sky, a cable path, and continuous replacement supplies remain planning assumptions."
	for route: Dictionary in _last_result.get("primary_routes", []):
		if route.recipe == line.recipe:
			inspector.text += "\nPrimary supply: %s. Other useful outputs are credited across the factory.\n" % PlannerDisplay.markup(_resources.get(route.resource, route.resource))
	inspector.get_v_scroll_bar().set_deferred("value", 0.0)
	%RemoveGoal.text = "Remove selected goal"
	%RemoveGoal.disabled = !_request.goals.any(func(goal: Dictionary) -> bool: return goal.get("recipe") == _selected)


func _inspected_line() -> Dictionary:
	for node: PlannerRecipeNode in _nodes.values():
		if node.get_meta("position_key") == _inspected_key && !node.has_meta("flow_endpoint") && !node.has_meta("storage_unit"):
			return node.allocation
	return {}


func _ingredient_flows(line: Dictionary, recipe: Dictionary) -> Array:
	var flows: Array = recipe.get("inputs", []).duplicate()
	var configuration: Dictionary = line.get("configuration_details", {})
	flows.append_array(configuration.get("inputs", []))
	for point: Dictionary in configuration.get("operating_points", []):
		flows.append_array(point.get("inputs", []))
	return flows


func _inspector_context(node: PlannerRecipeNode) -> Dictionary:
	var line: Dictionary = node.allocation
	var key: String = node.get_meta("position_key")
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for candidate: PlannerRecipeNode in _nodes.values():
		by_key[candidate.get_meta("position_key")] = candidate
	var incoming: Array[Dictionary] = []
	var outgoing: Array[Dictionary] = []
	for connection: Dictionary in _graph_connections:
		var neighbor := ""
		var target: Array[Dictionary] = []
		if connection.destination == key:
			neighbor = connection.source
			target = incoming
		elif connection.source == key:
			neighbor = connection.destination
			target = outgoing
		if !by_key.has(neighbor):
			continue
		var entry := connection.duplicate()
		entry.key = neighbor
		entry.title = by_key[neighbor].title
		entry.exact = str(connection.get("rate_exact", {}).get("display", ""))
		target.append(entry)
	var routes: Array[Dictionary] = []
	for output: Dictionary in line.outputs:
		var resource: String = output.resource
		var count: int = _routes_by_resource.get(resource, []).size()
		if count > 1:
			routes.append({"resource": resource, "name": _resources.get(resource, PlannerDisplay.readable_name(resource)),
				"count": count, "pinned": _request.get("routes", {}).get(resource, "") == line.recipe})
	var ingredients: Array[Dictionary] = []
	var ingredient_flows := _ingredient_flows(line, _recipes[line.recipe])
	for slot: int in ingredient_flows.size():
		var flow: Dictionary = ingredient_flows[slot]
		if flow.get("choices", []).size() < 2:
			continue
		var selected := ""
		for chosen: Dictionary in line.get("ingredient_choices", []):
			if int(chosen.slot) == slot && float(chosen.rate) > 0:
				selected = chosen.resource
				break
		var pin: String = _request.get("ingredients", {}).get("%s#%d" % [line.recipe, slot], "")
		ingredients.append({"slot": slot, "name": _resources.get(selected, PlannerDisplay.readable_name(selected)) if !selected.is_empty() else "Automatic",
			"pinned": !pin.is_empty(), "choices": flow.choices.size()})
	return {"incoming": incoming, "outgoing": outgoing, "routes": routes, "ingredients": ingredients}


func _jump_to_node(key: String) -> void:
	for node: PlannerRecipeNode in _nodes.values():
		if node.get_meta("position_key") == key:
			_select_node(node)
			_focus_recipe(true)
			return


func _highlight_neighbors(key: String) -> void:
	var sources: Dictionary[String, bool] = {}
	var destinations: Dictionary[String, bool] = {}
	for connection: Dictionary in _graph_connections:
		if connection.destination == key:
			sources[connection.source] = true
		if connection.source == key:
			destinations[connection.destination] = true
	for node: PlannerRecipeNode in _nodes.values():
		var node_key: String = node.get_meta("position_key")
		if key.is_empty():
			node.modulate = Color.WHITE
			node.set_meta("relation", "")
			node.set_flow_emphasis(0.55)
		elif node_key == key:
			node.modulate = Color("fff4cf")
			node.set_meta("relation", "selected")
			node.set_flow_emphasis(1.0)
		elif sources.has(node_key) && destinations.has(node_key):
			node.modulate = Color("f4dcff")
			node.set_meta("relation", "both")
			node.set_flow_emphasis(1.0)
		elif sources.has(node_key):
			node.modulate = Color("b8fff0")
			node.set_meta("relation", "supplier")
			node.set_flow_emphasis(1.0)
		elif destinations.has(node_key):
			node.modulate = Color("ffdbac")
			node.set_meta("relation", "consumer")
			node.set_flow_emphasis(1.0)
		else:
			node.modulate = Color("a9b5b9")
			node.set_meta("relation", "other")
			node.set_flow_emphasis(0.22)


func _refresh_connections() -> void:
	graph.prepare_routes(_nodes)
	graph.clear_connections()
	_graph_link_errors.clear()
	var shown := 0
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
	for connection: Dictionary in _graph_connections:
		if !by_key.has(connection.source) || !by_key.has(connection.destination):
			_graph_link_errors.append("Missing endpoint for %s." % connection.resource)
			continue
		var source: PlannerRecipeNode = by_key[connection.source]
		var destination: PlannerRecipeNode = by_key[connection.destination]
		if !source.output_ports.has(connection.resource) || !destination.input_ports.has(connection.resource):
			_graph_link_errors.append("Missing port for %s." % connection.resource)
			continue
		if %ConnectionMode.selected == 1 && connection.resource == "energy:eu":
			continue
		if %ConnectionMode.selected == 2 && connection.source != _inspected_key && connection.destination != _inspected_key:
			continue
		if graph.connect_node(source.name, source.output_ports[connection.resource],
				destination.name, destination.input_ports[connection.resource]) != OK:
			_graph_link_errors.append("Could not draw %s." % connection.resource)
		else:
			if connection.source == _inspected_key || connection.destination == _inspected_key:
				graph.set_connection_activity(source.name, source.output_ports[connection.resource],
					destination.name, destination.input_ports[connection.resource], 0.9)
			shown += 1
	%Hint.text = "%d/%d flows · Middle drag: pan · Ctrl+wheel: zoom" % [shown, _graph_connections.size()]
	%Hint.tooltip_text = "The connection filter changes only the drawing. All production flows remain in the plan."
	if %ConnectionMode.selected == 1:
		return
	for unit: Dictionary in _last_result.get("periodic_power", {}).get("storage", []):
		if unit.machines <= 0:
			continue
		var storage_key: String = "planner:storage|%s|planner:storage|%s" % [unit.machine, unit.machine]
		if !by_key.has(storage_key):
			continue
		for source: Dictionary in _last_result.periodic_power.generation:
			if source.machines <= 0:
				continue
			var source_key: String = str(source.recipe) + "|" + str(source.configuration)
			if !by_key.has(source_key) || %ConnectionMode.selected == 2 && source_key != _inspected_key && storage_key != _inspected_key:
				continue
			var producer: PlannerRecipeNode = by_key[source_key]
			var buffer: PlannerRecipeNode = by_key[storage_key]
			graph.connect_node(producer.name, producer.output_ports["energy:eu"], buffer.name, buffer.input_ports["energy:eu"])


func _focus_recipe(include_supplier: bool = false) -> void:
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
	if !by_key.has(_inspected_key):
		return
	var selected: PlannerRecipeNode = by_key[_inspected_key]
	var target := Rect2(selected.position_offset, selected.size)
	var candidates: Array[Dictionary] = []
	var requested_output := Rect2()
	for connection: Dictionary in _graph_connections:
		if connection.destination != _inspected_key || connection.resource == "energy:eu":
			continue
		if by_key.has(connection.source):
			var source: PlannerRecipeNode = by_key[connection.source]
			candidates.append({"rect": Rect2(source.position_offset, source.size),
				"distance": selected.position_offset.distance_squared_to(source.position_offset)})
	for connection: Dictionary in _graph_connections:
		if connection.source == _inspected_key && str(connection.destination).begins_with("goal:") && by_key.has(connection.destination):
			var goal: PlannerRecipeNode = by_key[connection.destination]
			requested_output = Rect2(goal.position_offset, goal.size)
			target = target.merge(requested_output)
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return a.distance < b.distance)
	if include_supplier:
		if !candidates.is_empty():
			var nearby: Rect2 = target.merge(candidates[0].rect)
			var fit: float = minf((graph.size.x - 60) / nearby.size.x,
				(graph.size.y - 60) / nearby.size.y)
			graph.zoom = clampf(fit, graph.zoom_min, 1.0)
		var chosen := 0
		for candidate: Dictionary in candidates:
			var expanded: Rect2 = target.merge(candidate.rect)
			if (expanded.size.x * graph.zoom <= graph.size.x - 40 &&
					expanded.size.y * graph.zoom <= graph.size.y - 40):
				target = expanded
				chosen += 1
			if chosen == 3:
				break
	else:
		graph.zoom = clampf(minf((graph.size.x - 60) / target.size.x,
			(graph.size.y - 60) / target.size.y), graph.zoom_min, 0.8)
	var offset: Vector2 = target.get_center() * graph.zoom - graph.size / 2.0
	if target.size.y * graph.zoom < graph.size.y - 150.0:
		offset.y -= 45.0
	graph.scroll_offset = offset
	_save_view()


func _show_power() -> void:
	_highlight_neighbors("")
	inspector.visible = false
	inspector_cards.visible = true
	inspector.text = PlannerDisplay.optimization_report(_last_result) + PlannerDisplay.power_report(_last_result.get("power", {}), _resources, _last_result.get("construction", {}))
	inspector.scroll_to_line(0)
	inspector_cards.show_plan(_last_result)
	%EditGoal.disabled = true
	%RemoveGoal.disabled = true
	inspector_cards.grab_focus()


func _arrange() -> void:
	_remember()
	await _apply_layout()
	layout_settled.emit()


func _expand_graph(expanded: bool) -> void:
	var center := (graph.scroll_offset + graph.size / 2.0) / graph.zoom
	%Library.visible = !expanded
	%InspectorPanel.visible = !expanded
	%ExpandGraph.text = "Show panels" if expanded else "Expand graph"
	await get_tree().process_frame
	graph.scroll_offset = center * graph.zoom - graph.size / 2.0
	graph.grab_focus()


func _apply_layout(announce: bool = true) -> void:
	var entries: Array[PlannerGraphLayout.Entry] = []
	var group_for_key: Dictionary[String, String] = {}
	for node: PlannerRecipeNode in _nodes.values():
		if node.has_meta("flow_endpoint"):
			continue
		var group := "Power"
		if !node.has_meta("storage_unit"):
			var recipe: Dictionary = _recipes[node.recipe_id]
			group = recipe.get("group", "Power" if recipe.primary == "energy:eu" else "Production")
		var key: String = node.get_meta("position_key")
		group_for_key[key] = group
		entries.append(PlannerGraphLayout.Entry.new(key, group, node.size, node.title))
	for node: PlannerRecipeNode in _nodes.values():
		if !node.has_meta("flow_endpoint"):
			continue
		var key: String = node.get_meta("position_key")
		var neighbor_groups: Dictionary[String, int] = {}
		for connection: Dictionary in _graph_connections:
			var neighbor: String = connection.destination if connection.source == key else (
				connection.source if connection.destination == key else "")
			if group_for_key.has(neighbor):
				var group: String = group_for_key[neighbor]
				neighbor_groups[group] = neighbor_groups.get(group, 0) + 1
		var chosen := "Production"
		var best := 0
		for group: String in neighbor_groups:
			if neighbor_groups[group] > best:
				chosen = group
				best = neighbor_groups[group]
		entries.append(PlannerGraphLayout.Entry.new(key, chosen, node.size, node.title))
	var layout_connections: Array = _graph_connections.duplicate()
	for unit: Dictionary in _last_result.get("periodic_power", {}).get("storage", []):
		if unit.machines <= 0:
			continue
		var storage_key: String = "planner:storage|%s|planner:storage|%s" % [unit.machine, unit.machine]
		for source: Dictionary in _last_result.periodic_power.generation:
			if source.machines > 0:
				layout_connections.append({"source": str(source.recipe) + "|" + str(source.configuration),
					"destination": storage_key, "resource": "dispatch_buffer"})
	var focus: Array[String] = []
	var goal_recipes: Dictionary[String, bool] = {}
	for goal: Dictionary in _request.get("goals", []):
		if goal.has("recipe"):
			goal_recipes[str(goal.recipe)] = true
		var endpoint_key := "goal:" + str(goal.get("resource", ""))
		if _nodes.values().any(func(node: PlannerRecipeNode) -> bool:
			return node.get_meta("position_key") == endpoint_key):
			focus.append(endpoint_key)
	if focus.is_empty():
		for node: PlannerRecipeNode in _nodes.values():
			if !node.has_meta("flow_endpoint") && goal_recipes.has(node.recipe_id):
				focus.append(node.get_meta("position_key"))
	_layout_revision += 1
	var revision := _layout_revision
	_layout_response = {}
	var measured := _measure_graph()
	status.text = "Arranging production branches and routing connections…"
	%Arrange.disabled = true
	%Cancel.disabled = false
	layout_computation.submit({"kind": "graph_layout", "nodes": measured, "focus": focus,
		"connections": layout_connections})
	while layout_computation.busy && revision == _layout_revision:
		await get_tree().process_frame
	if revision != _layout_revision:
		return
	%Arrange.disabled = false
	%Cancel.disabled = true
	if _layout_response.is_empty():
		return
	var layout := PlannerGraphLayout.Result.new()
	for key: String in _layout_response.positions:
		var point: Array = _layout_response.positions[key]
		layout.positions[key] = Vector2(point[0], point[1])
	layout = PlannerGraphLayout.group_positions(entries, layout_connections, layout, focus)
	graph.routes = _layout_response.routes

	if _last_result.get("lines", []).is_empty() && _nodes.size() > 1 && _nodes.values().all(func(node: PlannerRecipeNode) -> bool: return node.has_meta("storage_unit")):
		var storage_bounds := Rect2(Vector2(20, 40), Vector2.ZERO)
		var storage_index := 0
		for node: PlannerRecipeNode in _nodes.values():
			var position := Vector2(45 + (storage_index % 2) * 340, 75 + floori(storage_index / 2.0) * 160)
			layout.positions[node.get_meta("position_key")] = position
			storage_bounds = storage_bounds.expand(position + node.size + Vector2(25, 25))
			storage_index += 1
		layout.groups["Power"] = storage_bounds
	_rendering = true
	for node: PlannerRecipeNode in _nodes.values():
		node.position_offset = layout.positions[node.get_meta("position_key")]
	_groups.clear()
	var index := 0
	var bounds := Rect2()
	for entry: PlannerGraphLayout.Entry in entries:
		var area := Rect2(layout.positions[entry.key], entry.size)
		bounds = area if bounds.size == Vector2.ZERO else bounds.merge(area)
	for title: String in layout.groups:
		var rect: Rect2 = layout.groups[title]
		_groups["line_%d" % index] = {"title": layout.titles.get(title, title), "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y]}
		bounds = bounds.merge(rect)
		index += 1
	_rendering = false
	_restore_groups()
	if bounds.size.x > 0 && bounds.size.y > 0:
		graph.zoom = clampf(minf((graph.size.x - 60) / bounds.size.x, (graph.size.y - 90) / bounds.size.y), graph.zoom_min, 1.0)
		graph.scroll_offset = bounds.position * graph.zoom - Vector2(30, 55)
	_unplaced.clear()
	_refresh_connections()
	_save_positions(false)
	status.text = "Graph arranged. Select a line to trace its suppliers and consumers."
	if announce:
		%Feedback.confirm()


func _measure_graph() -> Array[Dictionary]:
	var measured: Array[Dictionary] = []
	for node: PlannerRecipeNode in _nodes.values():
		var ports: Array[Dictionary] = []
		for resource: String in node.input_ports:
			var point := node.get_input_port_position(node.input_ports[resource])
			ports.append({"resource": resource, "side": "WEST", "x": point.x, "y": point.y})
		for resource: String in node.output_ports:
			var point := node.get_output_port_position(node.output_ports[resource])
			ports.append({"resource": resource, "side": "EAST", "x": point.x, "y": point.y})
		measured.append({"id": node.get_meta("position_key"), "width": node.size.x,
			"height": node.size.y, "ports": ports, "local_to": node.get_meta("flow_endpoint", {}).get("local_to", "")})
	return measured


func _reroute_graph() -> void:
	if _nodes.is_empty() || layout_computation.busy:
		return
	_layout_revision += 1
	var revision := _layout_revision
	_layout_response = {}
	var positions: Dictionary[String, Array] = {}
	for node: PlannerRecipeNode in _nodes.values():
		positions[node.get_meta("position_key")] = [node.position_offset.x, node.position_offset.y]
	layout_computation.submit({"kind": "graph_layout", "nodes": _measure_graph(),
		"connections": _graph_connections, "positions": positions})
	while layout_computation.busy && revision == _layout_revision:
		await get_tree().process_frame
	if revision != _layout_revision || _layout_response.is_empty():
		return
	graph.routes = _layout_response.routes
	_refresh_connections()
	_autosave()


func _place_new_nodes() -> void:
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	var occupied: Array[Rect2] = []
	var pending: Array[PlannerRecipeNode] = []
	for node: PlannerRecipeNode in _nodes.values():
		var key: String = node.get_meta("position_key")
		by_key[key] = node
		if key in _unplaced && !node.has_meta("flow_endpoint"):
			pending.append(node)
		elif !key in _unplaced:
			occupied.append(Rect2(node.position_offset, node.size))
	while !pending.is_empty():
		var chosen := -1
		var preferred := Vector2.ZERO
		for index: int in pending.size():
			var node: PlannerRecipeNode = pending[index]
			var key: String = node.get_meta("position_key")
			for connection: Dictionary in _graph_connections:
				if connection.resource == "energy:eu":
					continue
				var other: String = connection.destination if connection.source == key else (
					connection.source if connection.destination == key else "")
				if !by_key.has(other) || pending.has(by_key[other]) || by_key[other].has_meta("flow_endpoint"):
					continue
				var neighbor: PlannerRecipeNode = by_key[other]
				preferred = neighbor.position_offset + Vector2(
					-node.size.x - 80 if connection.source == key else neighbor.size.x + 80, 0)
				chosen = index
				break
			if chosen >= 0:
				break
		if chosen < 0:
			chosen = 0
			var right := 25.0
			for area: Rect2 in occupied:
				right = maxf(right, area.end.x + 80)
			preferred = Vector2(right, 75)
		var node: PlannerRecipeNode = pending.pop_at(chosen)
		node.position_offset = _free_graph_position(preferred, node.size, occupied)
		occupied.append(Rect2(node.position_offset, node.size))
	_place_endpoint_nodes(false)
	_unplaced.clear()
	_save_positions(false)


func _place_endpoint_nodes(force: bool) -> void:
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	var occupied: Array[Rect2] = []
	var endpoints: Array[PlannerRecipeNode] = []
	for node: PlannerRecipeNode in _nodes.values():
		by_key[node.get_meta("position_key")] = node
		if node.has_meta("flow_endpoint"):
			endpoints.append(node)
			if !force && !node.get_meta("position_key") in _unplaced:
				occupied.append(Rect2(node.position_offset, node.size))
		else:
			occupied.append(Rect2(node.position_offset, node.size))
	endpoints.sort_custom(func(a: PlannerRecipeNode, b: PlannerRecipeNode) -> bool:
		return String(a.get_meta("position_key")) < String(b.get_meta("position_key")))
	for node: PlannerRecipeNode in endpoints:
		var key: String = node.get_meta("position_key")
		if !force && !key in _unplaced:
			continue
		var anchor: PlannerRecipeNode
		for connection: Dictionary in _graph_connections:
			var neighbor: String = connection.destination if connection.source == key else (
				connection.source if connection.destination == key else "")
			if by_key.has(neighbor) && !by_key[neighbor].has_meta("flow_endpoint"):
				anchor = by_key[neighbor]
				break
		var preferred := Vector2.ZERO
		if anchor:
			var at := anchor.position_offset
			var size := anchor.size
			if node.get_meta("flow_endpoint").kind in ["external", "gap"]:
				preferred = at + Vector2(-node.size.x - 55, 0)
			else:
				preferred = at + Vector2(size.x + 55, 0)
		else:
			var right := 25.0
			for area: Rect2 in occupied:
				right = maxf(right, area.end.x + 55)
			preferred = Vector2(right, 75)
		node.position_offset = _free_graph_position(preferred, node.size, occupied)
		occupied.append(Rect2(node.position_offset, node.size))


func _free_graph_position(preferred: Vector2, size: Vector2, occupied: Array[Rect2]) -> Vector2:
	var step := size + Vector2(96, 96)
	for radius: int in 32:
		for horizontal: int in range(-radius, radius + 1):
			var vertical := radius - absi(horizontal)
			for sign: int in [-1, 1]:
				var position := preferred + Vector2(horizontal * step.x, sign * vertical * step.y)
				if position.x < 25 || position.y < 55:
					continue
				var area := Rect2(position, size).grow(48)
				if occupied.all(func(other: Rect2) -> bool: return !area.intersects(other)):
					return position
	var right := 25.0
	for area: Rect2 in occupied:
		right = maxf(right, area.end.x + 80)
	return Vector2(right, 75)


func _add_group() -> void:
	_initial_layout = false
	_unplaced.clear()
	_remember()
	var key := "group_%d" % Time.get_ticks_usec()
	var position := graph.scroll_offset / graph.zoom + Vector2(25, 55)
	var size := Vector2(660, 360)
	for node: PlannerRecipeNode in _nodes.values():
		if node.get_meta("position_key") == _inspected_key:
			position = node.position_offset - Vector2(24, 45)
			size = Vector2(maxf(420.0, node.size.x + 48.0), maxf(300.0, node.size.y + 90.0))
			break
	_groups[key] = {"title": "Production line %d" % (_groups.size() + 1),
		"rect": [position.x, position.y, size.x, size.y]}
	_restore_groups()
	_autosave()
	status.text = "Drag the group title to move its members. Resize its border to change membership."


func _restore_groups() -> void:
	_rendering = true
	for frame: GraphFrame in _frames.values():
		frame.free()
	_frames.clear()
	for key: String in _groups:
		var frame := group_scene.instantiate() as GraphFrame
		frame.name = key
		frame.title = _groups[key].title
		var rect: Array = _groups[key].rect
		graph.add_child(frame)
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


func _save_positions(reroute: bool = true) -> void:
	if _rendering:
		return
	for node: PlannerRecipeNode in _nodes.values():
		_positions[node.get_meta("position_key")] = [node.position_offset.x, node.position_offset.y]
	_resizing_group = ""
	_update_membership()
	_autosave()
	if reroute:
		if layout_computation.busy:
			_cancel_layout()
		_reroute_graph.call_deferred()


func _delete_nodes(names: Array[StringName]) -> void:
	if names.all(func(name: StringName) -> bool:
		return _nodes.has(name) && _nodes[name].has_meta("flow_endpoint")):
		status.text = "Supply and output endpoints follow the plan. Edit a goal or external supply to change them."
		return
	_remember()
	var ids: Array[String] = []
	for node_name: StringName in names:
		if _nodes.has(node_name):
			var node: PlannerRecipeNode = _nodes[node_name]
			if node.has_meta("flow_endpoint"):
				continue
			if node.has_meta("storage_unit"):
				_request.periodic_storage.erase(node.get_meta("storage_unit").machine)
			else:
				ids.append(node.recipe_id)
		elif _groups.has(node_name):
			_groups.erase(node_name)
	_request.goals = _request.goals.filter(func(goal: Dictionary) -> bool: return !goal.get("recipe") in ids)
	_recalculate()


func _snapshot() -> Dictionary:
	for node: PlannerRecipeNode in _nodes.values():
		_positions[node.get_meta("position_key")] = [node.position_offset.x, node.position_offset.y]
	return {"format": "factory-plan", "version": 1, "dataset_identity": _dataset.get("identity", "custom"), "dataset": _dataset,
		"view": _pending_view.duplicate(true) if !_pending_view.is_empty() else _view_snapshot(),
		"graph_routes": graph.routes.duplicate(true), "request": _request.duplicate(true), "positions": _positions.duplicate(true), "groups": _groups.duplicate(true), "imported_world": _world_import.duplicate(true),
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
	_pending_view = value.get("view", {}).duplicate(true)
	_inspected_key = _pending_view.get("inspected", "")
	%ConnectionMode.select(clampi(int(_pending_view.get("connections", 0)), 0, 2))
	graph.routes = value.get("graph_routes", []).duplicate(true)
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
	var snapshot := _snapshot()
	snapshot.erase("dataset")
	var dataset_text := ""
	if _dataset_storage_key.is_empty():
		dataset_text = JSON.stringify(_dataset, "", true, true)
		_dataset_storage_key = dataset_text.sha256_text()
	snapshot.dataset_ref = _dataset_storage_key
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.save(%s, %s)" % [JSON.stringify(snapshot, "", true, true), dataset_text if !dataset_text.is_empty() else "null"])
		return
	if !dataset_text.is_empty():
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://datasets"))
		var cached_path := "user://datasets/" + _dataset_storage_key + ".json"
		var cached := FileAccess.open(cached_path, FileAccess.WRITE)
		if !cached:
			_dataset_storage_key = ""
			_failed("The dataset could not be saved. Export your plan to keep a portable copy.")
			return
		cached.store_string(dataset_text)
		cached.close()
	var file := FileAccess.open("user://autosave.pending", FileAccess.WRITE)
	if !file:
		_failed("The workspace could not be saved. Export your plan to keep a portable copy.")
		return
	file.store_string(JSON.stringify(snapshot, "", true, true))
	file.close()
	if DirAccess.rename_absolute(ProjectSettings.globalize_path("user://autosave.pending"), ProjectSettings.globalize_path("user://autosave.json")) != OK:
		_failed("The workspace save could not be replaced. Export your plan to keep a portable copy.")
	_save_view()


func _view_snapshot() -> Dictionary:
	return {"zoom": graph.zoom, "scroll": [graph.scroll_offset.x, graph.scroll_offset.y], "inspected": _inspected_key, "connections": %ConnectionMode.selected}


func _save_view() -> void:
	if _dataset.is_empty() || !_pending_view.is_empty():
		return
	var record := {"dataset_identity": _dataset.get("identity", "custom"), "view": _view_snapshot()}
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.saveView(%s)" % JSON.stringify(record, "", true, true))
	else:
		var file := FileAccess.open("user://workspace-view.json", FileAccess.WRITE)
		file.store_string(JSON.stringify(record, "", true, true))
		file.close()


func _choose_import() -> void:
	if OS.has_feature("web"):
		if _json_import:
			_stop_json_import()
			status.text = "Plan import cancelled. The current graph is preserved."
		JavaScriptBridge.eval("window.plannerBridge.chooseFile()")
		return
	_file_action = "import"
	files.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	files.popup_centered()


func _choose_export() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.download(%s)" % JSON.stringify(_snapshot(), "", true, true))
		return
	_file_action = "export"
	files.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	files.current_file = "factory-plan.json"
	files.popup_centered()


func _file_selected(path: String) -> void:
	if _file_action == "export":
		var file := FileAccess.open(path, FileAccess.WRITE)
		file.store_string(JSON.stringify(_snapshot(), "  ", true, true))
		status.text = "Plan exported."
	elif path.get_extension().to_lower() == "zip":
		_import_world(path)
	else:
		_import_json(PlannerJson.parse(FileAccess.get_file_as_string(path)))


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
		_request = _new_request()
		_positions.clear()
		_groups.clear()
		_world_import.clear()
		_recalculate()
	else:
		_failed(PlannerDatasetValidation.check(parsed))


func _cancel_layout() -> void:
	_layout_revision += 1
	layout_computation.cancel()
	%Arrange.disabled = false


func _cancel() -> void:
	_cancel_layout()
	if _json_import:
		_stop_json_import()
		status.text = "Plan import cancelled. The current graph is preserved."
		return
	computation.cancel()
	%Cancel.disabled = true
	status.text = "Calculation cancelled. The current graph is preserved."


func _failed(message: String) -> void:
	_capture_result({"status": "error", "reason": message})
	if _job_kind == "preview_configuration" && %GoalEditor.visible:
		%GoalEditor.show_error(message)
		return
	%Feedback.error()
	%Cancel.disabled = true
	status.text = message
	status.tooltip_text = message
