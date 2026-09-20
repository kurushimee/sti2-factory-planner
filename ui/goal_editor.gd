class_name PlannerGoalEditor
extends ConfirmationDialog

signal preview_requested(selection: Dictionary)
signal goal_changed(index: int, goal: Dictionary, selection: Dictionary, pin: bool)

var _dataset: Dictionary = {}
var _request: Dictionary = {}
var _recipe: Dictionary = {}
var _preview: Dictionary = {}
var _selection: Dictionary = {}
var _loading := false
var _goal_index := -1
var _revision := 0


func _ready() -> void:
	%GoalKind.add_item("Output rate")
	%GoalKind.add_item("Machine capacity")
	%GoalKind.add_item("Finite quantity")
	%ExistingGoal.item_selected.connect(_select_goal)
	%GoalMachine.item_selected.connect(_machine_changed)
	for control: OptionButton in [%GoalKind, %GoalResource, %GoalUpgrade, %GoalContained]:
		control.item_selected.connect(func(_index: int) -> void: _changed())
	for control: SpinBox in [%GoalRate, %GoalMachines, %GoalUpgradeCount, %GoalContainedCount, %GoalBatch, %GoalShape]:
		control.value_changed.connect(func(_value: float) -> void: _changed())
	%GoalQuantity.text_changed.connect(func(_text: String) -> void: _changed())
	%GoalPin.toggled.connect(func(_value: bool) -> void: _changed())
	%GoalSteel.toggled.connect(func(_value: bool) -> void: _changed())
	%PreviewDelay.timeout.connect(_request_preview)
	confirmed.connect(_apply)
	canceled.connect(func() -> void: %PreviewDelay.stop())
	var controls: Array[Control] = [%ExistingGoal, %GoalKind, %GoalResource, %GoalRate.get_line_edit(), %GoalQuantity,
		%GoalMachines.get_line_edit(), %GoalPin, %GoalMachine, %GoalUpgrade, %GoalUpgradeCount.get_line_edit(),
		%GoalContained, %GoalContainedCount.get_line_edit(), %GoalBatch.get_line_edit(), %GoalShape.get_line_edit(),
		%GoalSteel, get_ok_button(), get_cancel_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])


func open_goal(recipe: Dictionary, dataset: Dictionary, request: Dictionary) -> void:
	_loading = true
	_recipe = recipe
	_dataset = dataset
	_request = request
	%GoalTitle.text = recipe.get("name", recipe.id)
	%ExistingGoal.clear()
	%ExistingGoal.add_item("Add an independent goal")
	%ExistingGoal.set_item_metadata(0, -1)
	for index: int in request.goals.size():
		var goal: Dictionary = request.goals[index]
		if goal.get("recipe") == recipe.id:
			%ExistingGoal.add_item("Edit goal %d · %s" % [index + 1, goal.get("kind", "rate").capitalize()])
			%ExistingGoal.set_item_metadata(%ExistingGoal.item_count - 1, index)
	%GoalResource.clear()
	for flow: Dictionary in recipe.outputs:
		%GoalResource.add_item(_resource_name(flow.resource))
		%GoalResource.set_item_metadata(%GoalResource.item_count - 1, flow.resource)
	%GoalMachine.clear()
	if recipe.has("process"):
		for machine: Dictionary in dataset.get("machines", []):
			if machine.get("status") != "supported":
				continue
			if machine.get("recipe_type") != recipe.process.type && !recipe.process.type in machine.get("contained_recipe_types", {}).values():
				continue
			%GoalMachine.add_item(_resource_name("item:" + machine.id))
			%GoalMachine.set_item_metadata(%GoalMachine.item_count - 1, machine)
	else:
		for configuration: Dictionary in recipe.configurations:
			%GoalMachine.add_item(_resource_name("item:" + configuration.machine))
			%GoalMachine.set_item_metadata(%GoalMachine.item_count - 1, configuration)
	_loading = false
	%ExistingGoal.select(1 if %ExistingGoal.item_count > 1 else 0)
	_select_goal(%ExistingGoal.selected)
	popup_centered(Vector2i(900, 680))
	%ExistingGoal.grab_focus.call_deferred()


func _resource_name(id: String) -> String:
	for resource: Dictionary in _dataset.resources:
		if resource.id == id:
			return resource.get("name", id)
	return id.trim_prefix("item:").replace("_", " ")


func _select_goal(index: int) -> void:
	_loading = true
	_goal_index = %ExistingGoal.get_item_metadata(index)
	var goal: Dictionary = _request.goals[_goal_index] if _goal_index >= 0 else {}
	%GoalKind.select(["rate", "capacity", "quantity"].find(goal.get("kind", "rate")))
	%GoalRate.value = goal.get("rate", 1)
	%GoalQuantity.text = str(goal.get("quantity", 1000))
	%GoalMachines.value = goal.get("machines", 1)
	%GoalPin.set_pressed_no_signal(_request.get("configurations", {}).has(_recipe.id))
	for resource_index: int in %GoalResource.item_count:
		if %GoalResource.get_item_metadata(resource_index) == goal.get("resource", _recipe.primary):
			%GoalResource.select(resource_index)
	var chosen_setup: Dictionary = {}
	for setup: Dictionary in _request.get("machine_setups", {}).get(_recipe.id, []):
		if setup.get("configuration", "") == goal.get("configuration", "missing"):
			chosen_setup = setup
			break
		if !setup.has("configuration") && goal.get("configuration", "").contains("|" + str(setup.machine) + "|"):
			chosen_setup = setup
	for machine_index: int in %GoalMachine.item_count:
		var machine: Dictionary = %GoalMachine.get_item_metadata(machine_index)
		if machine.get("id") == chosen_setup.get("machine") || machine.get("id") == goal.get("configuration"):
			%GoalMachine.select(machine_index)
	_machine_changed(%GoalMachine.selected)
	var setup: Dictionary = chosen_setup.get("setup", {})
	%GoalUpgradeCount.value = setup.get("upgrade_count", 0)
	%GoalContainedCount.value = setup.get("contained_count", 1)
	%GoalBatch.value = setup.get("batch", setup.get("contained_count", 1))
	%GoalShape.value = setup.get("shape", 0) + 1
	%GoalSteel.set_pressed_no_signal(setup.get("steel_hatches", false))
	for upgrade_index: int in %GoalUpgrade.item_count:
		if %GoalUpgrade.get_item_metadata(upgrade_index).get("id") == setup.get("upgrade", {}).get("id"):
			%GoalUpgrade.select(upgrade_index)
	for contained_index: int in %GoalContained.item_count:
		if %GoalContained.get_item_metadata(contained_index) == setup.get("contained_machine"):
			%GoalContained.select(contained_index)
	_loading = false
	_changed()


func _machine_changed(_index: int) -> void:
	%GoalUpgrade.clear()
	%GoalUpgrade.add_item("No upgrades")
	%GoalUpgrade.set_item_metadata(0, {})
	%GoalContained.clear()
	var machine: Dictionary = %GoalMachine.get_item_metadata(%GoalMachine.selected) if %GoalMachine.selected >= 0 else {}
	for upgrade: Dictionary in _dataset.get("upgrades", []):
		if upgrade.id in machine.get("upgrades", []):
			%GoalUpgrade.add_item(_resource_name("item:" + upgrade.id))
			%GoalUpgrade.set_item_metadata(%GoalUpgrade.item_count - 1, upgrade)
	%GoalUpgradeCount.max_value = machine.get("upgrade_limit", 0)
	for contained: String in machine.get("eligible_machines", []):
		if machine.get("contained_recipe_types", {}).get(contained) == _recipe.get("process", {}).get("type"):
			%GoalContained.add_item(_resource_name("item:" + contained))
			%GoalContained.set_item_metadata(%GoalContained.item_count - 1, contained)
	%GoalBatch.max_value = machine.get("batch_limit", 64 if machine.get("mechanic") == "mi_array" else 1)
	%GoalShape.max_value = maxi(1, maxi(machine.get("batch_tiers", []).size(), maxi(machine.get("shape_capacities", []).size(), maxi(machine.get("recipe_eu_limits", []).size(), machine.get("fluid_output_limits", []).size()))))
	%GoalSteel.visible = machine.has("steel_hatch_variant")
	for control: Control in [%GoalUpgrade, %GoalUpgradeLabel, %GoalUpgradeCount, %GoalUpgradeCountLabel]:
		control.visible = %GoalUpgrade.item_count > 1
	for control: Control in [%GoalBatch, %GoalBatchLabel]:
		control.visible = %GoalBatch.max_value > 1
	for control: Control in [%GoalShape, %GoalShapeLabel]:
		control.visible = %GoalShape.max_value > 1
	for control: Control in [%GoalContained, %GoalContainedLabel, %GoalContainedCount, %GoalContainedCountLabel]:
		control.visible = machine.get("mechanic") == "mi_array"
	_changed()


func _changed() -> void:
	if _loading:
		return
	_preview = {}
	_revision += 1
	%GoalUpgradeCount.editable = %GoalUpgrade.selected > 0
	if %GoalUpgrade.selected == 0:
		%GoalUpgradeCount.set_value_no_signal(0)
	var capacity: bool = %GoalKind.selected == 1
	%GoalMachines.editable = capacity
	%GoalRate.editable = !capacity
	%GoalQuantity.editable = %GoalKind.selected == 2
	%GoalPin.disabled = capacity
	get_ok_button().disabled = true
	%GoalPreview.text = "Calculating this configuration…"
	%PreviewDelay.start()


func _request_preview() -> void:
	if !visible:
		return
	if %GoalMachine.selected < 0:
		show_error("No machine configuration is available for this recipe.")
		return
	var machine: Dictionary = %GoalMachine.get_item_metadata(%GoalMachine.selected)
	_selection = {"recipe": _recipe.id, "revision": _revision}
	if %GoalKind.selected == 2:
		_selection.quantity = %GoalQuantity.text.strip_edges()
		_selection.rate = %GoalRate.value
	if _recipe.has("process"):
		var upgrade: Dictionary = %GoalUpgrade.get_item_metadata(%GoalUpgrade.selected)
		var setup: Dictionary = {"upgrade_count": int(%GoalUpgradeCount.value) if !upgrade.is_empty() else 0,
			"batch": int(%GoalBatch.value), "shape": int(%GoalShape.value) - 1, "steel_hatches": %GoalSteel.visible && %GoalSteel.button_pressed}
		if !upgrade.is_empty():
			setup.upgrade = upgrade
		if machine.get("mechanic") == "mi_array" && %GoalContained.selected >= 0:
			setup.contained_machine = %GoalContained.get_item_metadata(%GoalContained.selected)
			setup.contained_count = int(%GoalContainedCount.value)
		_selection.machine = machine.id
		_selection.setup = setup
	else:
		_selection.configuration = machine.id
	preview_requested.emit(_selection)


func show_preview(result: Dictionary) -> void:
	if int(result.get("revision", -1)) != _revision || !visible:
		return
	_preview = result
	var configuration: Dictionary = result.configuration
	var count: float = %GoalMachines.value if %GoalKind.selected == 1 else 1
	var text := "[b]Configured capacity[/b]\n"
	for output: Dictionary in result.outputs:
		text += "%s: %s /s%s\n" % [_resource_name(output.resource), String.num(output.rate_per_machine * count, 4), " per machine" if %GoalKind.selected != 1 else ""]
	text += "%s operations/s per machine · %s EU per operation\n" % [String.num(configuration.operations_per_second, 4), String.num(configuration.get("eu_per_operation", 0), 3)]
	if %GoalKind.selected == 2:
		text += "Production time after startup: %s.\n" % result.production_time.time_display
	text += "Capacity assumes continuous ingredients. The connected plan supplies the remaining demand."
	%GoalPreview.text = text
	get_ok_button().disabled = false


func show_error(message: String) -> void:
	_preview = {}
	%GoalPreview.text = message
	get_ok_button().disabled = true


func _apply() -> void:
	if _preview.is_empty():
		return
	var kind: String = ["rate", "capacity", "quantity"][%GoalKind.selected]
	var goal: Dictionary = {"recipe": _recipe.id, "resource": %GoalResource.get_item_metadata(%GoalResource.selected), "kind": kind}
	if kind == "capacity":
		goal.configuration = _preview.configuration.id
		goal.machines = int(%GoalMachines.value)
	else:
		goal.rate = %GoalRate.value
		if kind == "quantity":
			goal.quantity = %GoalQuantity.text.strip_edges()
	_selection.configuration = _preview.configuration.id
	goal_changed.emit(_goal_index, goal, _selection, %GoalPin.button_pressed || kind == "capacity")
