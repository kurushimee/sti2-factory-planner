class_name PlannerFactorySettings
extends ConfirmationDialog

signal settings_changed(request: Dictionary)

const PAGE_SIZE := 150

var _dataset: Dictionary[String, Variant] = {}
var _request: Dictionary[String, Variant] = {}
var _imported_storage: Dictionary = {}
var _imported_solar: Dictionary = {}
var _names: Dictionary[String, String] = {}
var _entries: Array[Dictionary] = []
var _matches: Array[Dictionary] = []
var _page := 0
var _supply := ""
var _loading := false
var _construction: Dictionary = {}


func _ready() -> void:
	for title_text: String in ["Machines", "Upgrades", "Production routes", "Obtained templates", "External supplies", "Structure hatches", "Construction costs", "Infrastructure", "Power storage", "Power sources"]:
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
	%InfrastructureCount.value_changed.connect(func(value: float) -> void:
		var selected: TreeItem = %SettingsEntries.get_selected()
		if selected:
			for entry: Dictionary in _request.infrastructure:
				if _infrastructure_key(entry) == selected.get_metadata(0):
					entry.count = int(value)
	)
	%InfrastructureHatch.item_selected.connect(func(_index: int) -> void: _infrastructure_changed())
	%InfrastructureTransfer.value_changed.connect(func(_value: float) -> void: _infrastructure_changed())
	%StorageInstalledEnabled.toggled.connect(func(_value: bool) -> void: _storage_changed())
	%StorageInstalled.value_changed.connect(func(_value: float) -> void: _storage_changed())
	%StorageLimitEnabled.toggled.connect(func(_value: bool) -> void: _storage_changed())
	%StorageLimit.value_changed.connect(func(_value: float) -> void: _storage_changed())
	%PowerSourceCount.value_changed.connect(func(_value: float) -> void: _power_source_changed())
	confirmed.connect(_apply)
	var controls: Array[Control] = [%ProgressionPreset, %UsePreset, %SettingsCategory, %SettingsSearch, %ConstructionEnabled, %ConstructionWeight.get_line_edit(), %ConstructionRounding, %SettingsEntries, %SettingsPrevious,
		%SettingsNext, %InfrastructureCount.get_line_edit(), %InfrastructureHatch, %InfrastructureTransfer.get_line_edit(),
		%StorageInstalledEnabled, %StorageInstalled.get_line_edit(), %StorageLimitEnabled, %StorageLimit.get_line_edit(),
		%PowerSourceCount.get_line_edit(),
		%SupplyUnlimited, %SupplyLimit.get_line_edit(), %SupplyCost.get_line_edit(),
		%Reserve.get_line_edit(), %Overhead.get_line_edit(), %ResourceWeight.get_line_edit(),
		%MachineWeight.get_line_edit(), %EnergyWeight.get_line_edit(), %RoutePreferences, get_ok_button(), get_cancel_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])


func open_settings(dataset: Dictionary, request: Dictionary, world: Dictionary = {}) -> void:
	_dataset.assign(dataset)
	_request.assign(request.duplicate(true))
	_imported_storage.clear()
	_imported_solar.clear()
	for panel: Dictionary in world.get("reconstruction", {}).get("solar_panels", []):
		_imported_solar[panel.configuration] = int(_imported_solar.get(panel.configuration, 0)) + 1
	for unit: Dictionary in world.get("reconstruction", {}).get("storage_units", []):
		var id: String = unit.machine_id
		if !_imported_storage.has(id):
			_imported_storage[id] = {"count": 0, "included": 0, "saved_charge_eu": 0}
		var record: Dictionary = _imported_storage[id]
		record.count += 1
		record.included += 1 if unit.get("enabled", true) else 0
		record.saved_charge_eu += int(unit.saved_charge_eu)
	_construction = _request.get("construction", {}).duplicate(true)
	if !_construction.has("external"):
		_construction.external = []
	%ConstructionEnabled.set_pressed_no_signal(_request.has("construction"))
	%ConstructionWeight.value = _construction.get("weight", 1)
	%ConstructionRounding.set_pressed_no_signal(_construction.get("round_batches", false))
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
	for field: String in ["available_upgrades", "disabled_recipes", "obtained_resources", "external", "infrastructure", "periodic_storage"]:
		if !_request.has(field):
			_request[field] = []
	for field: String in ["periodic_storage_limits", "periodic_storage_installed", "installed"]:
		if !_request.has(field):
			_request[field] = {}
	var weights: Dictionary = _request.get("weights", {})
	%ResourceWeight.value = weights.get("external", 1000)
	%MachineWeight.value = weights.get("machines", 1)
	%EnergyWeight.value = weights.get("energy", 0.000001)
	%RoutePreferences.set_pressed_no_signal(_request.get("honor_route_preferences", true))
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
	_request.periodic_storage = _request.periodic_storage.filter(func(id: String) -> bool: return id in _request.available_machines)
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
	%InfrastructureDetails.visible = category == 7
	%StorageDetails.visible = category == 8
	%PowerSourceDetails.visible = category == 9
	%InfrastructureCount.editable = false
	_supply_reset()
	%Supply.visible = category in [4, 6]
	%ConstructionOptions.visible = category == 6
	%ConstructionRounding.visible = category == 6
	%Progression.visible = category != 6 && !_dataset.get("progression", []).is_empty()
	%SettingsEntries.custom_minimum_size.y = 135 if category in [8, 9] else (155 if category == 7 else (235 if category == 6 else 275))
	%SettingsEntries.size_flags_vertical = Control.SIZE_FILL if category in [8, 9] else Control.SIZE_EXPAND_FILL
	if category in [8, 9]:
		_fit_storage_dialog()
	%SupplyUnlimited.text = "No construction quantity limit" if category == 6 else "No external supply rate limit"
	%SupplyLimit.suffix = "quantity available" if category == 6 else "/s maximum"
	var hints: Array[String] = ["Choose machines the planner may build. Unsupported machines remain visible but cannot be enabled.",
		"Enable upgrade types for automatic loadout choices. Explicit saved or pinned loadouts retain their selected upgrades.",
		"Disable a recipe to exclude that production route. Its resources must come from another enabled route or an explicit supply.",
		"Mark resources already obtained as replication templates. Each replicator also needs one retained template item.",
		"External supplies are deliberate imports into the factory. Select a resource to set its rate limit and cost. Item rates use items/s; fluid rates use mB/s; power uses EU/s.",
		"Choose hatches available for multiblock structures. Build lists use verified storage and power limits; unsupported hatch types remain visible.",
		"Select purchased construction supplies and their prices. Other parts need an enabled recipe. Construction workstations must already be available. Whole batches round crafts and tools; random yields remain estimates. Supplies here are quantities, not rates.",
		"Enable towers, then choose their count, input/receiver tier, and planned transfer. Idle drain adds to other overhead. Structural bills assume independent cable networks; receiver coverage needs a separate check.",
		"Choose lossless storage tiers for periodic generation. The planner sizes whole units and their initial charge. Solar cell expiry currently supports one selected tier; clear weather remains an assumption.",
		"Fix installed generator counts when you own a specific setup. Leave a source unchecked to let the planner choose it when needed. Saved cells and fuel are stocks, not continuous supplies."]
	%SettingsHint.text = hints[category]
	match category:
		0:
			var seen: Dictionary[String, bool] = {}
			for machine: Dictionary in _dataset.get("machines", []):
				if machine.get("status") in ["structural", "infrastructure"]:
					continue
				seen[machine.id] = true
				var name_text: String = _names.get("item:" + str(machine.id), machine.id)
				if !machine.get("availability", {}).get("automatic", true):
					name_text += " · not normally obtainable"
				_entries.append({"id": machine.id, "name": name_text,
					"unsupported": machine.get("status") != "supported", "detail": machine.get("availability", {}).get("reason", machine.get("reason", machine.id))})
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
				_entries.append({"id": recipe.id, "name": PlannerDisplay.recipe_name(recipe),
					"unsupported": recipe.has("unsupported"), "detail": recipe.get("unsupported", recipe.id)})
		3, 4, 6:
			for resource: Dictionary in _dataset.resources:
				_entries.append({"id": resource.id, "name": resource.get("name", resource.id)})
		5:
			var supported := RegEx.create_from_string("^modern_industrialization:((bronze|steel|advanced|turbo|highly_advanced|lv|mv|hv|ev|superconductor)_(item|fluid|energy)_(input|output)|nuclear_item)_hatch$")
			for machine: Dictionary in _dataset.get("machines", []):
				if machine.has("hatch_capacity"):
					_entries.append({"id": machine.id, "name": _names.get("item:" + str(machine.id), machine.id),
						"unsupported": supported.search(machine.id) == null})
		7:
			for machine: Dictionary in _dataset.get("machines", []):
				for variant: Dictionary in machine.get("infrastructure", []):
					_entries.append({"id": str(machine.id) + "|" + str(variant.id), "name": variant.get("name", variant.id),
						"variant": variant, "machine": machine.id,
						"detail": "%s EU/t per enabled machine. Transfer and range do not prove receiver coverage." % PlannerDisplay.number(variant.passive_eu_per_tick)})
			for selection: Dictionary in _request.infrastructure:
				if !selection.has("id"):
					continue
				for machine: Dictionary in _dataset.get("machines", []):
					if machine.id != selection.machine:
						continue
					for variant: Dictionary in machine.get("infrastructure", []):
						if variant.id == selection.variant:
							_entries.append({"id": selection.id, "name": "%s · %s" % [variant.get("name", variant.id), selection.id], "variant": variant, "selection": selection.duplicate(true), "detail": selection.get("operation_basis", "Separate infrastructure configuration.")})
		8:
			for machine: Dictionary in _dataset.get("machines", []):
				if machine.get("mechanic") != "energy_storage":
					continue
				var rule: Dictionary = machine.storage
				_entries.append({"id": machine.id, "name": _names.get("item:" + str(machine.id), machine.id),
					"detail": "%s EU capacity; %s EU/t charge and %s EU/t discharge per unit. %s" % [PlannerDisplay.number(rule.capacity_eu), PlannerDisplay.number(rule.charge_eu_per_tick), PlannerDisplay.number(rule.discharge_eu_per_tick), rule.get("basis", "")]})
		9:
			for recipe: Dictionary in _dataset.get("recipes", []):
				if !recipe.outputs.any(func(flow: Dictionary) -> bool: return flow.resource == "energy:eu"):
					continue
				for configuration: Dictionary in recipe.configurations:
					_entries.append({"id": configuration.id, "name": "%s · %s" % [PlannerDisplay.recipe_name(recipe), PlannerDisplay.machine_name(configuration.machine, _names)],
						"machine": configuration.machine, "unsupported": recipe.has("unsupported"),
						"detail": "%s\n%s" % [recipe.id, configuration.id]})
	_filter(%SettingsSearch.text)


func _fit_storage_dialog() -> void:
	get_tree().create_timer(0.01).timeout.connect(func() -> void:
		if %SettingsCategory.selected in [8, 9]:
			size = Vector2i(1040, 710))


func _infrastructure_key(entry: Dictionary) -> String:
	return entry.get("id", str(entry.machine) + "|" + str(entry.variant))


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
		7: return _request.infrastructure.any(func(entry: Dictionary) -> bool: return _infrastructure_key(entry) == id)
		6: return _construction.external.any(func(entry: Dictionary) -> bool: return entry.resource == id)
		8: return id in _request.periodic_storage
		9: return _request.installed.has(id)
	return false


func _entry_changed() -> void:
	var item: TreeItem = %SettingsEntries.get_edited()
	if !item:
		return
	var id: String = item.get_metadata(0)
	if %SettingsCategory.selected == 7:
		_request.infrastructure = _request.infrastructure.filter(func(entry: Dictionary) -> bool: return _infrastructure_key(entry) != id)
		if item.is_checked(0):
			var row: Dictionary = _entries.filter(func(entry: Dictionary) -> bool: return entry.id == id)[0]
			var definition: Dictionary = row.variant
			var selection: Dictionary = row.get("selection", {}).duplicate(true)
			if selection.is_empty():
				selection = {"machine": row.machine, "variant": definition.id, "count": 1}
			if !selection.has("energy_hatch") && definition.has("default_energy_hatch"):
				selection.energy_hatch = definition.default_energy_hatch
				selection.transmit_eu_per_tick = definition.max_transfer_eu_per_tick
			_request.infrastructure.append(selection)
		_entry_selected()
		return
	if %SettingsCategory.selected == 8:
		_request.periodic_storage.erase(id)
		if item.is_checked(0):
			_request.periodic_storage.append(id)
			if !id in _request.available_machines:
				_request.available_machines.append(id)
		_entry_selected()
		return
	if %SettingsCategory.selected == 9:
		if item.is_checked(0):
			_request.installed[id] = int(_request.installed.get(id, _imported_solar.get(id, 1)))
			for entry: Dictionary in _entries:
				if entry.id == id && !entry.machine in _request.available_machines:
					_request.available_machines.append(entry.machine)
					break
		else:
			_request.installed.erase(id)
		_entry_selected()
		return
	var enabled := item.is_checked(0)
	if %SettingsCategory.selected in [4, 6]:
		var record: Dictionary = _construction if %SettingsCategory.selected == 6 else _request
		record.external = record.external.filter(func(entry: Dictionary) -> bool: return entry.resource != id)
		if enabled:
			record.external.append({"resource": id, "cost": 1})
		_entry_selected()
		return
	var field: String = ["available_machines", "available_upgrades", "disabled_recipes", "obtained_resources", "external", "available_parts"][%SettingsCategory.selected]
	var include := !enabled if %SettingsCategory.selected == 2 else enabled
	_request[field].erase(id)
	if include:
		_request[field].append(id)


func _entry_selected() -> void:
	_supply_reset()
	if %SettingsCategory.selected == 9:
		var source: TreeItem = %SettingsEntries.get_selected()
		%PowerSourceImported.text = "Select a generator to set an installed count."
		%PowerSourceCount.editable = false
		if source:
			var source_id: String = source.get_metadata(0)
			if _imported_solar.has(source_id):
				var count: int = _imported_solar[source_id]
				var panel_word := "panel" if count == 1 else "panels"
				%PowerSourceImported.text = "World snapshot: %d saved %s with this route. Saved cell and water are startup stocks." % [count, panel_word]
			if _request.installed.has(source_id):
				_loading = true
				%PowerSourceCount.set_value_no_signal(_request.installed[source_id])
				%PowerSourceCount.editable = true
				_loading = false
		return
	if %SettingsCategory.selected == 8:
		var chosen: TreeItem = %SettingsEntries.get_selected()
		%StorageImported.text = "Select a storage tier to inspect saved units."
		if chosen:
			var snapshot: Dictionary = _imported_storage.get(chosen.get_metadata(0), {})
			if !snapshot.is_empty():
				%StorageImported.text = "World snapshot: %d units, %s EU saved; %d included. Saved charge is initial stock." % [snapshot.count, str(snapshot.saved_charge_eu), snapshot.included]
		var enabled: bool = chosen != null && chosen.get_metadata(0) in _request.periodic_storage
		%StorageInstalledEnabled.disabled = !enabled
		%StorageLimitEnabled.disabled = !enabled
		%StorageInstalled.editable = enabled && %StorageInstalledEnabled.button_pressed
		%StorageLimit.editable = enabled && %StorageLimitEnabled.button_pressed
		if enabled:
			var id: String = chosen.get_metadata(0)
			_loading = true
			%StorageInstalledEnabled.set_pressed_no_signal(_request.periodic_storage_installed.has(id))
			%StorageInstalled.set_value_no_signal(_request.periodic_storage_installed.get(id, 1))
			%StorageLimitEnabled.set_pressed_no_signal(_request.periodic_storage_limits.has(id))
			%StorageLimit.set_value_no_signal(_request.periodic_storage_limits.get(id, 1))
			%StorageInstalled.editable = %StorageInstalledEnabled.button_pressed
			%StorageLimit.editable = %StorageLimitEnabled.button_pressed
			_loading = false
		return
	if %SettingsCategory.selected == 7:
		%InfrastructureCount.editable = false
		%InfrastructureHatch.disabled = true
		%InfrastructureTransfer.editable = false
		var selected: TreeItem = %SettingsEntries.get_selected()
		if selected:
			for entry: Dictionary in _request.infrastructure:
				if _infrastructure_key(entry) == selected.get_metadata(0):
					%InfrastructureCount.set_value_no_signal(entry.count)
					%InfrastructureCount.editable = true
					_loading = true
					%InfrastructureHatch.clear()
					%InfrastructureHatch.add_item("Choose an input and receiver tier…")
					%InfrastructureHatch.set_item_metadata(0, "")
					for machine: Dictionary in _dataset.get("machines", []):
						if machine.get("hatch_type") == "modern_industrialization:energy_input" && String(machine.id).begins_with("modern_industrialization:"):
							var index: int = %InfrastructureHatch.item_count
							%InfrastructureHatch.add_item(_names.get("item:" + str(machine.id), machine.id))
							%InfrastructureHatch.set_item_metadata(index, machine.id)
							if entry.get("energy_hatch", "") == machine.id: %InfrastructureHatch.select(index)
					%InfrastructureHatch.disabled = false
					%InfrastructureTransfer.set_value_no_signal(entry.get("transmit_eu_per_tick", 0))
					%InfrastructureTransfer.editable = true
					_loading = false
		return
	if !%SettingsCategory.selected in [4, 6]:
		return
	var item: TreeItem = %SettingsEntries.get_selected()
	if !item:
		return
	var id: String = item.get_metadata(0)
	var limit_key := "quantity" if %SettingsCategory.selected == 6 else "limit"
	var supplies: Array = _construction.external if %SettingsCategory.selected == 6 else _request.external
	for entry: Dictionary in supplies:
		if entry.resource != id:
			continue
		_loading = true
		_supply = id
		%SupplyUnlimited.disabled = false
		%SupplyUnlimited.set_pressed_no_signal(!entry.has(limit_key))
		%SupplyLimit.value = entry.get(limit_key, 0)
		%SupplyCost.value = entry.get("cost", 1)
		%SupplyLimit.editable = entry.has(limit_key)
		%SupplyCost.editable = true
		_loading = false


func _infrastructure_changed() -> void:
	if _loading:
		return
	var selected: TreeItem = %SettingsEntries.get_selected()
	if !selected:
		return
	for entry: Dictionary in _request.infrastructure:
		if _infrastructure_key(entry) == selected.get_metadata(0):
			var hatch: String = %InfrastructureHatch.get_selected_metadata()
			if hatch.is_empty(): entry.erase("energy_hatch")
			else: entry.energy_hatch = hatch
			entry.transmit_eu_per_tick = PlannerDisplay.input_value(%InfrastructureTransfer)


func _storage_changed() -> void:
	if _loading || %SettingsCategory.selected != 8:
		return
	var chosen: TreeItem = %SettingsEntries.get_selected()
	if !chosen || !chosen.get_metadata(0) in _request.periodic_storage:
		return
	var id: String = chosen.get_metadata(0)
	%StorageInstalled.editable = %StorageInstalledEnabled.button_pressed
	%StorageLimit.editable = %StorageLimitEnabled.button_pressed
	if %StorageInstalledEnabled.button_pressed:
		_request.periodic_storage_installed[id] = int(%StorageInstalled.value)
	else:
		_request.periodic_storage_installed.erase(id)
	if %StorageLimitEnabled.button_pressed:
		_request.periodic_storage_limits[id] = int(%StorageLimit.value)
	else:
		_request.periodic_storage_limits.erase(id)


func _power_source_changed() -> void:
	if _loading || %SettingsCategory.selected != 9:
		return
	var chosen: TreeItem = %SettingsEntries.get_selected()
	if chosen && _request.installed.has(chosen.get_metadata(0)):
		_request.installed[chosen.get_metadata(0)] = int(%PowerSourceCount.value)


func _supply_changed() -> void:
	if _loading || _supply.is_empty():
		return
	%SupplyLimit.editable = !%SupplyUnlimited.button_pressed
	var limit_key := "quantity" if %SettingsCategory.selected == 6 else "limit"
	var supplies: Array = _construction.external if %SettingsCategory.selected == 6 else _request.external
	for entry: Dictionary in supplies:
		if entry.resource == _supply:
			entry.cost = PlannerDisplay.input_value(%SupplyCost)
			if %SupplyUnlimited.button_pressed:
				entry.erase(limit_key)
			else:
				entry[limit_key] = PlannerDisplay.input_value(%SupplyLimit)


func _apply() -> void:
	_request.reserve_fraction = PlannerDisplay.input_value(%Reserve) / 100
	_request.overhead_eu_per_tick = PlannerDisplay.input_value(%Overhead)
	_request.weights = {"external": PlannerDisplay.input_value(%ResourceWeight), "machines": PlannerDisplay.input_value(%MachineWeight), "energy": PlannerDisplay.input_value(%EnergyWeight)}
	_request.honor_route_preferences = %RoutePreferences.button_pressed
	if %ConstructionEnabled.button_pressed:
		_construction.weight = PlannerDisplay.input_value(%ConstructionWeight)
		_construction.round_batches = %ConstructionRounding.button_pressed
		_request.construction = _construction.duplicate(true)
	else:
		_request.erase("construction")
	settings_changed.emit(_request.duplicate(true))
