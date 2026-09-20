class_name PlannerFactorySettings
extends ConfirmationDialog

signal settings_changed(request: Dictionary)

const PAGE_SIZE := 150

var _dataset: Dictionary[String, Variant] = {}
var _request: Dictionary[String, Variant] = {}
var _names: Dictionary[String, String] = {}
var _entries: Array[Dictionary] = []
var _matches: Array[Dictionary] = []
var _page := 0
var _supply := ""
var _loading := false


func _ready() -> void:
	for title_text: String in ["Machines", "Upgrades", "Production routes", "Obtained templates", "External supplies", "Structure hatches"]:
		%SettingsCategory.add_item(title_text)
	%SettingsCategory.item_selected.connect(_category_changed)
	%ProgressionPreset.item_selected.connect(func(index: int) -> void:
		%UsePreset.disabled = index == 0
		%ProgressionPreset.tooltip_text = str(_dataset.progression[index - 1].get("description", "")) if index > 0 else "Choose a progression preset."
	)
	%UsePreset.pressed.connect(_use_preset)
	%SettingsSearch.text_changed.connect(_filter)
	%SettingsEntries.item_edited.connect(_entry_changed)
	%SettingsEntries.item_selected.connect(_entry_selected)
	%SettingsPrevious.pressed.connect(func() -> void: _page -= 1; _show_page())
	%SettingsNext.pressed.connect(func() -> void: _page += 1; _show_page())
	%SupplyUnlimited.toggled.connect(func(_enabled: bool) -> void: _supply_changed())
	%SupplyLimit.value_changed.connect(func(_value: float) -> void: _supply_changed())
	%SupplyCost.value_changed.connect(func(_value: float) -> void: _supply_changed())
	%MachineWeight.value_changed.connect(func(value: float) -> void:
		get_ok_button().disabled = value <= 0
		%SettingsError.text = "Machine priority must be positive." if value <= 0 else ""
	)
	confirmed.connect(_apply)
	var controls: Array[Control] = [%ProgressionPreset, %UsePreset, %SettingsCategory, %SettingsSearch, %SettingsEntries, %SettingsPrevious,
		%SettingsNext, %SupplyUnlimited, %SupplyLimit.get_line_edit(), %SupplyCost.get_line_edit(),
		%Reserve.get_line_edit(), %Overhead.get_line_edit(), %ResourceWeight.get_line_edit(),
		%MachineWeight.get_line_edit(), %EnergyWeight.get_line_edit(), get_ok_button(), get_cancel_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])


func open_settings(dataset: Dictionary, request: Dictionary) -> void:
	_dataset.assign(dataset)
	_request.assign(request.duplicate(true))
	_names.clear()
	for resource: Dictionary in dataset.resources:
		_names[resource.id] = resource.get("name", resource.id)
	if !_request.has("available_machines"):
		var machines: Array = dataset.get("default_machines", []).duplicate()
		if !dataset.has("default_machines"):
			for machine: Dictionary in dataset.get("machines", []):
				machines.append(machine.id)
			for recipe: Dictionary in dataset.recipes:
				for configuration: Dictionary in recipe.configurations:
					if !configuration.machine in machines:
						machines.append(configuration.machine)
		_request.available_machines = machines
	if !_request.has("available_parts"):
		_request.available_parts = []
		for machine: Dictionary in dataset.get("machines", []):
			if machine.has("hatch_capacity"):
				_request.available_parts.append(machine.id)
	for pair: Array in [["available_machines", "disabled_machines"], ["available_upgrades", "disabled_upgrades"]]:
		for id: String in _request.get(pair[1], []):
			_request.get(pair[0], []).erase(id)
		_request.erase(pair[1])
	for field: String in ["available_upgrades", "disabled_recipes", "obtained_resources", "external"]:
		if !_request.has(field):
			_request[field] = []
	var weights: Dictionary = _request.get("weights", {})
	%ResourceWeight.value = weights.get("external", 1000)
	%MachineWeight.value = weights.get("machines", 1)
	%EnergyWeight.value = weights.get("energy", 0.000001)
	%Reserve.value = _request.get("reserve_fraction", 0) * 100
	%Overhead.value = _request.get("overhead_eu_per_tick", 0)
	%SettingsError.text = ""
	%Progression.visible = !_dataset.get("progression", []).is_empty()
	%ProgressionPreset.clear()
	%ProgressionPreset.add_item("Choose a progression preset…")
	for preset: Dictionary in _dataset.get("progression", []):
		%ProgressionPreset.add_item(preset.name)
		if preset.id == _request.get("progression_preset", ""):
			%ProgressionPreset.select(%ProgressionPreset.item_count - 1)
	%UsePreset.disabled = %ProgressionPreset.selected == 0
	_category_changed(%SettingsCategory.selected)
	popup_centered(Vector2i(1040, 710))
	%SettingsSearch.grab_focus.call_deferred()


func _use_preset() -> void:
	var index: int = %ProgressionPreset.selected - 1
	if index < 0:
		return
	var preset: Dictionary = _dataset.progression[index]
	_request.available_machines = preset.available_machines.duplicate()
	_request.available_upgrades = preset.available_upgrades.duplicate()
	if preset.has("available_parts"):
		_request.available_parts = preset.available_parts.duplicate()
	_request.progression_preset = preset.id
	%SettingsSearch.clear()
	_category_changed(%SettingsCategory.selected)
	%SettingsError.text = "%s selected. You can change individual entries before applying." % preset.name
	%SettingsEntries.grab_focus.call_deferred()


func _category_changed(category: int) -> void:
	_entries.clear()
	_supply_reset()
	%Supply.visible = category == 4
	var hints: Array[String] = ["Choose machines the planner may build. Unsupported machines remain visible but cannot be enabled.",
		"Enable upgrade types for automatic loadout choices. Explicit saved or pinned loadouts retain their selected upgrades.",
		"Disable a recipe to exclude that production route. Its resources must come from another enabled route or an explicit supply.",
		"Mark resources already obtained as replication templates. Each replicator also needs one retained template item.",
		"External supplies are deliberate imports into the factory. Select a resource to set its rate limit and cost. Item rates use items/s; fluid rates use mB/s; power uses EU/s.",
		"Choose hatches available for multiblock structures. Build lists use verified storage and power limits; unsupported hatch types remain visible."]
	%SettingsHint.text = hints[category]
	match category:
		0:
			var seen: Dictionary[String, bool] = {}
			for machine: Dictionary in _dataset.get("machines", []):
				if machine.get("status") == "structural":
					continue
				seen[machine.id] = true
				_entries.append({"id": machine.id, "name": _names.get("item:" + str(machine.id), machine.id),
					"unsupported": machine.get("status") != "supported", "detail": machine.get("reason", machine.id)})
			for recipe: Dictionary in _dataset.recipes:
				for configuration: Dictionary in recipe.configurations:
					if !seen.has(configuration.machine):
						seen[configuration.machine] = true
						_entries.append({"id": configuration.machine, "name": configuration.machine})
		1:
			for upgrade: Dictionary in _dataset.get("upgrades", []):
				_entries.append({"id": upgrade.id, "name": _names.get("item:" + str(upgrade.id), upgrade.id)})
		2:
			for recipe: Dictionary in _dataset.recipes:
				_entries.append({"id": recipe.id, "name": recipe.get("name", recipe.id),
					"unsupported": recipe.has("unsupported"), "detail": recipe.get("unsupported", recipe.id)})
		3, 4:
			for resource: Dictionary in _dataset.resources:
				_entries.append({"id": resource.id, "name": resource.get("name", resource.id)})
		5:
			var supported := RegEx.create_from_string("^modern_industrialization:(bronze|steel|advanced|turbo|highly_advanced|lv|mv|hv|ev|superconductor)_(item|fluid|energy)_(input|output)_hatch$")
			for machine: Dictionary in _dataset.get("machines", []):
				if machine.has("hatch_capacity"):
					_entries.append({"id": machine.id, "name": _names.get("item:" + str(machine.id), machine.id),
						"unsupported": supported.search(machine.id) == null})
	_filter(%SettingsSearch.text)


func _supply_reset() -> void:
	_supply = ""
	%SupplyUnlimited.disabled = true
	%SupplyLimit.editable = false
	%SupplyCost.editable = false


func _filter(query: String) -> void:
	_matches.clear()
	_page = 0
	var normalized := query.to_lower()
	for entry: Dictionary in _entries:
		if normalized.is_empty() || normalized in (str(entry.name) + " " + str(entry.id)).to_lower():
			_matches.append(entry)
	_show_page()


func _show_page() -> void:
	%SettingsEntries.clear()
	var root: TreeItem = %SettingsEntries.create_item()
	var first := _page * PAGE_SIZE
	var last := mini(first + PAGE_SIZE, _matches.size())
	for index: int in range(first, last):
		var entry: Dictionary = _matches[index]
		var item: TreeItem = %SettingsEntries.create_item(root)
		item.set_cell_mode(0, TreeItem.CELL_MODE_CHECK)
		item.set_text(0, entry.name + (" · unsupported" if entry.get("unsupported", false) else ""))
		item.set_metadata(0, entry.id)
		item.set_tooltip_text(0, entry.get("detail", entry.id))
		item.set_editable(0, !entry.get("unsupported", false))
		item.set_checked(0, _enabled(entry.id) && !entry.get("unsupported", false))
	%SettingsPage.text = "%d–%d of %d" % [first + 1 if last > first else 0, last, _matches.size()]
	%SettingsPrevious.disabled = first == 0
	%SettingsNext.disabled = last >= _matches.size()
	_supply_reset()


func _enabled(id: String) -> bool:
	match %SettingsCategory.selected:
		0: return id in _request.available_machines
		1: return id in _request.available_upgrades
		2: return !id in _request.disabled_recipes
		3: return id in _request.obtained_resources
		4: return _request.external.any(func(entry: Dictionary) -> bool: return entry.resource == id)
		5: return id in _request.available_parts
	return false


func _entry_changed() -> void:
	var item: TreeItem = %SettingsEntries.get_edited()
	if !item:
		return
	var id: String = item.get_metadata(0)
	var enabled := item.is_checked(0)
	if %SettingsCategory.selected == 4:
		_request.external = _request.external.filter(func(entry: Dictionary) -> bool: return entry.resource != id)
		if enabled:
			_request.external.append({"resource": id, "cost": 1})
		_entry_selected()
		return
	var field: String = ["available_machines", "available_upgrades", "disabled_recipes", "obtained_resources", "external", "available_parts"][%SettingsCategory.selected]
	var include := !enabled if %SettingsCategory.selected == 2 else enabled
	_request[field].erase(id)
	if include:
		_request[field].append(id)


func _entry_selected() -> void:
	_supply_reset()
	if %SettingsCategory.selected != 4:
		return
	var item: TreeItem = %SettingsEntries.get_selected()
	if !item:
		return
	var id: String = item.get_metadata(0)
	for entry: Dictionary in _request.external:
		if entry.resource != id:
			continue
		_loading = true
		_supply = id
		%SupplyUnlimited.disabled = false
		%SupplyUnlimited.set_pressed_no_signal(!entry.has("limit"))
		%SupplyLimit.value = entry.get("limit", 0)
		%SupplyCost.value = entry.get("cost", 1)
		%SupplyLimit.editable = entry.has("limit")
		%SupplyCost.editable = true
		_loading = false


func _supply_changed() -> void:
	if _loading || _supply.is_empty():
		return
	%SupplyLimit.editable = !%SupplyUnlimited.button_pressed
	for entry: Dictionary in _request.external:
		if entry.resource == _supply:
			entry.cost = %SupplyCost.value
			if %SupplyUnlimited.button_pressed:
				entry.erase("limit")
			else:
				entry.limit = %SupplyLimit.value


func _apply() -> void:
	_request.reserve_fraction = %Reserve.value / 100
	_request.overhead_eu_per_tick = %Overhead.value
	_request.weights = {"external": %ResourceWeight.value, "machines": %MachineWeight.value, "energy": %EnergyWeight.value}
	settings_changed.emit(_request.duplicate(true))
