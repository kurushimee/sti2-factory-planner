class_name PlannerWorldReview
extends ConfirmationDialog

signal corrections_requested(corrections: Dictionary)

const PAGE_SIZE := 150

var _world: Dictionary[String, Variant] = {}
var _dataset: Dictionary[String, Variant] = {}
var _corrections: Dictionary[String, Variant] = {}

var _selected := -1
var _machine_matches: Array[int] = []
var _recipe_matches: Array[Dictionary] = []
var _machine_page := 0
var _recipe_page := 0


func _ready() -> void:
	%WorldMachines.item_selected.connect(func(index: int) -> void: _select_machine(%WorldMachines.get_item_metadata(index)))
	%WorldMachineSearch.text_changed.connect(_filter_machines)
	%MachinePrevious.pressed.connect(func() -> void: _machine_page -= 1; _show_machines())
	%MachineNext.pressed.connect(func() -> void: _machine_page += 1; _show_machines())
	%RecipePrevious.pressed.connect(func() -> void: _recipe_page -= 1; _show_recipes())
	%RecipeNext.pressed.connect(func() -> void: _recipe_page += 1; _show_recipes())
	%WorldRecipeSearch.text_changed.connect(_filter_recipes)
	%WorldRecipes.item_selected.connect(_select_recipe)
	%RetainOutput.toggled.connect(_retain_changed)
	confirmed.connect(func() -> void: corrections_requested.emit(_corrections.duplicate(true)))
	var controls: Array[Control] = [%WorldMachineSearch, %WorldMachines, %MachinePrevious, %MachineNext, %WorldRecipeSearch, %WorldRecipes, %RecipePrevious, %RecipeNext, %RetainOutput, get_ok_button(), get_cancel_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])
		controls[index].focus_neighbor_right = controls[index].focus_next
		controls[index].focus_neighbor_left = controls[index].focus_previous


func open_review(world: Dictionary, dataset: Dictionary) -> void:
	_world.assign(world)
	_dataset.assign(dataset)
	_corrections.assign(world.get("corrections", {}).duplicate(true))
	_selected = -1
	%WorldMachineSearch.clear()
	%WorldRecipeSearch.clear()
	_filter_machines("")
	%WorldDetails.text = "Select a machine to review its assignment."
	%RetainOutput.disabled = true
	_filter_recipes("")
	var reconstruction: Dictionary = _world.get("reconstruction", {})
	%WorldSummary.text = "%d machines · %d capacity goals · %d storage units · %d infrastructure configurations · %d need correction\nSaved capacity assumes continuous supply. Stored energy and requester stocks are quantities." % [_world.get("machines", []).size(), reconstruction.get("goals", []).size(), reconstruction.get("storage_units", []).size(), reconstruction.get("infrastructure", []).size(), reconstruction.get("unresolved", []).size()]
	if %WorldMachines.item_count:
		%WorldMachines.select(0)
		_select_machine(0)
	size = Vector2i(1000, 650)
	await get_tree().process_frame
	popup_centered(Vector2i(1000, 650))
	%WorldMachineSearch.grab_focus.call_deferred()


func _filter_machines(query: String) -> void:
	_machine_matches.clear()
	_machine_page = 0
	var search := query.to_lower()
	for index: int in _world.get("machines", []).size():
		var machine: Dictionary = _world.machines[index]
		if search.is_empty() || search in (str(machine.id) + " " + _key(machine)).to_lower():
			_machine_matches.append(index)
	_show_machines()


func _show_machines() -> void:
	%WorldMachines.clear()
	for offset: int in range(_machine_page * PAGE_SIZE, mini((_machine_page + 1) * PAGE_SIZE, _machine_matches.size())):
		var machine_index: int = _machine_matches[offset]
		var machine: Dictionary = _world.machines[machine_index]
		var origin: Dictionary = machine.origin
		var index: int = %WorldMachines.add_item("%s · %d, %d, %d" % [str(machine.id).get_slice(":", 1).replace("_", " ").capitalize(), origin.x, origin.y, origin.z])
		%WorldMachines.set_item_metadata(index, machine_index)
		%WorldMachines.set_item_tooltip(index, "%s\n%s" % [machine.id, origin.dimension])
		if machine_index == _selected:
			%WorldMachines.select(index)
	%MachinePrevious.disabled = _machine_page == 0
	%MachineNext.disabled = (_machine_page + 1) * PAGE_SIZE >= _machine_matches.size()
	%MachinePage.text = _page_text(_machine_page, _machine_matches.size())


func _page_text(page: int, count: int) -> String:
	return "%d–%d of %d" % [page * PAGE_SIZE + 1, mini((page + 1) * PAGE_SIZE, count), count] if count else "No matches"


func _key(machine: Dictionary) -> String:
	var origin: Dictionary = machine.origin
	return "%s|%d|%d|%d" % [origin.dimension, origin.x, origin.y, origin.z]


func _select_machine(index: int) -> void:
	_selected = index
	%RetainOutput.disabled = false
	%RetainOutput.text = "Retain this output as a goal"
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
	%WorldDetails.text = "%s · %d, %d, %d\n%s\nRecipe: %s\nEvidence: %s\nUpgrades: %s" % [str(machine.id).get_slice(":", 1).replace("_", " ").capitalize(), machine.origin.x, machine.origin.y, machine.origin.z, machine.origin.dimension, recipe_name, machine.get("assignment_evidence", "unknown").replace("_", " "), upgrade_text]
	for unresolved: Dictionary in _world.get("reconstruction", {}).get("unresolved", []):
		if unresolved.get("machine") == key:
			%WorldDetails.text += "\n" + str(unresolved.reason)
	for candidate: Dictionary in _world.get("reconstruction", {}).get("infrastructure_candidates", []):
		if candidate.machine != key:
			continue
		%RetainOutput.text = "Plan continuous infrastructure operation"
		%RetainOutput.set_pressed_no_signal(_corrections.get(key, {}).get("infrastructure_enabled", candidate.enabled))
		%WorldDetails.text = "%s · %d, %d, %d\n%s\n%s" % [str(machine.id).get_slice(":", 1).replace("_", " ").capitalize(), machine.origin.x, machine.origin.y, machine.origin.z, machine.origin.dimension, candidate.assumption]
		var configuration: Dictionary = candidate.get("configuration", {})
		if !configuration.is_empty():
			%WorldDetails.text += "\nInput and receiver tier: %s\nSaved input hatches: %d\nTransmission capacity target: %s EU/t\n%s" % [configuration.energy_hatch, configuration.imported_hatches.size(), PlannerDisplay.number(configuration.transmit_eu_per_tick), configuration.transmission_basis]
		for unresolved: Dictionary in _world.get("reconstruction", {}).get("unresolved", []):
			if unresolved.get("machine") == key:
				%WorldDetails.text += "\n" + str(unresolved.reason)
	if _is_storage():
		%RetainOutput.disabled = true
		%RetainOutput.set_pressed_no_signal(false)
		%RetainOutput.text = "Energy storage has no output goal"
		%WorldDetails.text = "%s · %d, %d, %d\n%s\nEnergy storage. Saved charge is a starting quantity, not a sustained power supply." % [str(machine.id).get_slice(":", 1).replace("_", " ").capitalize(), machine.origin.x, machine.origin.y, machine.origin.z, machine.origin.dimension]
		for unit: Dictionary in _world.get("reconstruction", {}).get("storage_units", []):
			if unit.machine == key:
				%WorldDetails.text += "\nSaved charge: %s / %s EU\nCharge and discharge: %s EU/t each\n%s" % [unit.saved_charge_eu, PlannerDisplay.number(unit.capacity_eu), PlannerDisplay.number(unit.charge_eu_per_tick), unit.assumption]
		for unresolved: Dictionary in _world.get("reconstruction", {}).get("unresolved", []):
			if unresolved.get("machine") == key:
				%WorldDetails.text += "\n" + str(unresolved.reason)
	_filter_recipes(%WorldRecipeSearch.text, true)


func _filter_recipes(query: String, reveal_selected: bool = false) -> void:
	_recipe_matches.clear()
	_recipe_page = 0
	%WorldRecipeSearch.editable = !_is_nonrecipe()
	%WorldRecipeSearch.placeholder_text = "This device has no recipe assignment." if _is_nonrecipe() else "Find a compatible recipe…"
	if _selected >= 0 && !_is_nonrecipe():
		var machine: Dictionary = _world.machines[_selected]
		var chosen: String = str(_corrections.get(_key(machine), {}).get("recipe", machine.get("recipe_id", "")))
		var search := query.to_lower()
		for recipe: Dictionary in _dataset.get("recipes", []):
			if machine.get("recipe_type") != null && recipe.get("type") != machine.recipe_type && recipe.get("process", {}).get("type") != machine.recipe_type:
				continue
			var title: String = PlannerDisplay.recipe_name(recipe)
			if !search.is_empty() && !search in (title + " " + recipe.id).to_lower():
				continue
			if reveal_selected && (chosen == recipe.id || chosen == recipe.get("source_id")):
				_recipe_page = _recipe_matches.size() / PAGE_SIZE
			_recipe_matches.append(recipe)
	_show_recipes()


func _show_recipes() -> void:
	%WorldRecipes.clear()
	var chosen := ""
	if _selected >= 0:
		var machine: Dictionary = _world.machines[_selected]
		chosen = str(_corrections.get(_key(machine), {}).get("recipe", machine.get("recipe_id", "")))
	for offset: int in range(_recipe_page * PAGE_SIZE, mini((_recipe_page + 1) * PAGE_SIZE, _recipe_matches.size())):
		var recipe: Dictionary = _recipe_matches[offset]
		var index: int = %WorldRecipes.add_item("%s  ·  %s" % [PlannerDisplay.recipe_name(recipe), recipe.get("source_id", recipe.id)])
		%WorldRecipes.set_item_metadata(index, recipe.id)
		%WorldRecipes.set_item_tooltip(index, recipe.get("unsupported", recipe.id))
		if chosen == recipe.id || chosen == recipe.get("source_id"):
			%WorldRecipes.select(index)
			%WorldRecipes.ensure_current_is_visible()
	%RecipePrevious.disabled = _recipe_page == 0
	%RecipeNext.disabled = (_recipe_page + 1) * PAGE_SIZE >= _recipe_matches.size()
	%RecipePage.text = _page_text(_recipe_page, _recipe_matches.size())


func _select_recipe(index: int) -> void:
	if _selected < 0:
		return
	var key := _key(_world.machines[_selected])
	if !_corrections.has(key):
		_corrections[key] = {}
	_corrections[key].recipe = %WorldRecipes.get_item_metadata(index)


func _retain_changed(enabled: bool) -> void:
	if _selected < 0 || _is_storage():
		return
	var key := _key(_world.machines[_selected])
	if !_corrections.has(key):
		_corrections[key] = {}
	_corrections[key]["infrastructure_enabled" if _is_infrastructure() else "goal"] = enabled


func _is_infrastructure() -> bool:
	if _selected < 0:
		return false
	var key := _key(_world.machines[_selected])
	return _world.get("reconstruction", {}).get("infrastructure_candidates", []).any(func(candidate: Dictionary) -> bool: return candidate.machine == key)


func _is_storage() -> bool:
	if _selected < 0:
		return false
	var id: String = str(_world.machines[_selected].id)
	return _dataset.get("machines", []).any(func(machine: Dictionary) -> bool: return machine.get("id") == id && machine.get("mechanic") == "energy_storage")


func _is_nonrecipe() -> bool:
	return _is_infrastructure() || _is_storage()
