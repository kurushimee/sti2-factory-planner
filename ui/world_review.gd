class_name PlannerWorldReview
extends ConfirmationDialog

signal corrections_requested(corrections: Dictionary)

var _world: Dictionary[String, Variant] = {}
var _dataset: Dictionary[String, Variant] = {}
var _corrections: Dictionary[String, Variant] = {}
var _selected := -1


func _ready() -> void:
	%WorldMachines.item_selected.connect(_select_machine)
	%WorldRecipeSearch.text_changed.connect(_filter_recipes)
	%WorldRecipes.item_selected.connect(_select_recipe)
	%RetainOutput.toggled.connect(_retain_changed)
	confirmed.connect(func() -> void: corrections_requested.emit(_corrections.duplicate(true)))
	var controls: Array[Control] = [%WorldMachines, %WorldRecipeSearch, %WorldRecipes, %RetainOutput, get_ok_button(), get_cancel_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])
		controls[index].focus_neighbor_right = controls[index].focus_next
		controls[index].focus_neighbor_left = controls[index].focus_previous


func open_review(world: Dictionary, dataset: Dictionary) -> void:
	_world.assign(world)
	_dataset.assign(dataset)
	_corrections.assign(world.get("corrections", {}).duplicate(true))
	%WorldMachines.clear()
	for machine: Dictionary in _world.get("machines", []):
		var origin: Dictionary = machine.origin
		var index: int = %WorldMachines.add_item("%s · %d, %d, %d" % [machine.id.get_slice(":", 1).replace("_", " ").capitalize(), origin.x, origin.y, origin.z])
		%WorldMachines.set_item_tooltip(index, "%s\n%s" % [machine.id, origin.dimension])
	var reconstruction: Dictionary = _world.get("reconstruction", {})
	%WorldSummary.text = "%d machines · %d capacity goals · %d need correction\nSaved capacity assumes continuous supply. Requester stocks are quantities." % [_world.get("machines", []).size(), reconstruction.get("goals", []).size(), reconstruction.get("unresolved", []).size()]
	if %WorldMachines.item_count:
		%WorldMachines.select(0)
		_select_machine(0)
	size = Vector2i(1000, 650)
	await get_tree().process_frame
	popup_centered(Vector2i(1000, 650))
	%WorldMachines.grab_focus.call_deferred()


func _key(machine: Dictionary) -> String:
	var origin: Dictionary = machine.origin
	return "%s|%d|%d|%d" % [origin.dimension, origin.x, origin.y, origin.z]


func _select_machine(index: int) -> void:
	_selected = index
	var machine: Dictionary = _world.machines[index]
	var key := _key(machine)
	var retained := true
	for candidate: Dictionary in _world.get("reconstruction", {}).get("goal_candidates", []):
		if candidate.machine == key:
			retained = candidate.retained
	%RetainOutput.set_pressed_no_signal(_corrections.get(key, {}).get("goal", retained))
	var recipe_name: String = str(machine.recipe_id) if machine.get("recipe_id") != null else "Unassigned"
	var upgrade: Dictionary = machine.get("upgrades", {})
	var upgrade_text := "%d × %s" % [upgrade.get("count", 0), str(upgrade.get("id", "")).get_slice(":", 1).replace("_", " ")] if upgrade.has("id") else "None"
	%WorldDetails.text = "%s\nRecipe: %s\nEvidence: %s\nUpgrades: %s" % [machine.origin.dimension, recipe_name, machine.get("assignment_evidence", "unknown").replace("_", " "), upgrade_text]
	for unresolved: Dictionary in _world.get("reconstruction", {}).get("unresolved", []):
		if unresolved.get("machine") == key:
			%WorldDetails.text += "\n" + str(unresolved.reason)
	_filter_recipes(%WorldRecipeSearch.text)


func _filter_recipes(query: String) -> void:
	%WorldRecipes.clear()
	if _selected < 0:
		return
	var machine: Dictionary = _world.machines[_selected]
	var chosen: String = str(_corrections.get(_key(machine), {}).get("recipe", machine.get("recipe_id", "")))
	for recipe: Dictionary in _dataset.get("recipes", []):
		if machine.get("recipe_type") != null && recipe.get("type") != machine.recipe_type && recipe.get("process", {}).get("type") != machine.recipe_type:
			continue
		var title: String = recipe.get("name", recipe.id)
		if !query.is_empty() && !query.to_lower() in (title + " " + recipe.id).to_lower():
			continue
		var index: int = %WorldRecipes.add_item("%s  ·  %s" % [title, recipe.get("source_id", recipe.id)])
		%WorldRecipes.set_item_metadata(index, recipe.id)
		%WorldRecipes.set_item_tooltip(index, recipe.get("unsupported", recipe.id))
		if chosen == recipe.id || chosen == recipe.get("source_id"):
			%WorldRecipes.select(index)


func _select_recipe(index: int) -> void:
	if _selected < 0:
		return
	var key := _key(_world.machines[_selected])
	if !_corrections.has(key):
		_corrections[key] = {}
	_corrections[key].recipe = %WorldRecipes.get_item_metadata(index)


func _retain_changed(enabled: bool) -> void:
	if _selected < 0:
		return
	var key := _key(_world.machines[_selected])
	if !_corrections.has(key):
		_corrections[key] = {}
	_corrections[key].goal = enabled
