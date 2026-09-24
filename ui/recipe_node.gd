class_name PlannerRecipeNode
extends GraphNode

@onready var summary: Label = %Summary
@onready var throughput: Label = %Throughput
@onready var power: Label = %Power
@onready var loadout: Label = %Loadout

@export var flow_scene: PackedScene

var recipe_id := ""
var allocation: Dictionary[String, Variant] = {}
var input_ports: Dictionary[String, int] = {}
var output_ports: Dictionary[String, int] = {}
var _input_colors: Dictionary[int, Color] = {}
var _output_colors: Dictionary[int, Color] = {}


func configure(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String]) -> void:
	recipe_id = recipe.id
	allocation.assign(line)
	title = PlannerDisplay.readable_name(recipe.primary, recipe.get("name", ""))
	if title.length() > 44:
		title = title.left(41) + "…"
	summary.text = "%d × %s" % [int(line.machines), PlannerDisplay.machine_name(line.machine, resources)]
	loadout.text = PlannerDisplay.loadout(line.get("configuration_details", {}), resources)
	var chance_outputs: bool = recipe.get("expected_yields", false) || recipe.get("outputs", []).any(func(output: Dictionary) -> bool:
		return output.get("probability", 1) != 1)
	var primary_output: Dictionary = {}
	for flow: Dictionary in line.outputs:
		if flow.resource == recipe.primary:
			primary_output = flow
			break
	if primary_output.is_empty() && !line.outputs.is_empty():
		primary_output = line.outputs[0]
	throughput.text = PlannerDisplay.graph_flow_rate(primary_output.get("resource", recipe.primary),
		primary_output.get("rate", 0.0), primary_output.get("rate_exact", {}), primary_output.get("rate_eu_per_tick_exact", {}))
	if chance_outputs:
		throughput.text += " · expected yields"
	throughput.tooltip_text = "%s operations/s%s" % [line.get("operations_per_second_exact", {}).get("display", PlannerDisplay.number(line.operations_per_second)), " · expected yield" if chance_outputs else ""]
	var exact_power: String = line.get("power_eu_per_tick_exact", {}).get("display", PlannerDisplay.number(line.power_eu_per_tick))
	var exact_utilization: String = line.get("utilization_percent_exact", {}).get("display", PlannerDisplay.number(line.utilization * 100))
	power.text = "%s EU/t  ·  %s%%" % [PlannerDisplay.graph_exact(exact_power, line.power_eu_per_tick), PlannerDisplay.graph_exact(exact_utilization, line.utilization * 100)]
	power.tooltip_text = "%s EU/t · %s%% utilized" % [exact_power, exact_utilization]
	var inputs: Array = line.inputs.duplicate(true)
	if line.power_eu_per_tick > 0:
		inputs.append({"resource": "energy:eu", "rate": line.power_eu_per_tick * 20,
			"rate_exact": line.get("power_eu_per_second_exact", {}),
			"rate_eu_per_tick_exact": line.get("power_eu_per_tick_exact", {})})
	for direction: String in ["input", "output"]:
		var flows: Array = inputs if direction == "input" else line.outputs
		for flow: Dictionary in flows:
			var row := flow_scene.instantiate() as Label
			var slot := get_child_count()
			add_child(row)
			var label: String = resources.get(flow.resource, flow.resource)
			row.text = "%s %s  ·  %s" % ["←" if direction == "input" else "→", label,
				PlannerDisplay.graph_flow_rate(flow.resource, flow.rate, flow.get("rate_exact", {}), flow.get("rate_eu_per_tick_exact", {}))]
			row.tooltip_text = "%s\n%s" % [flow.resource, PlannerDisplay.flow_rate(flow.resource, flow.rate,
				flow.get("rate_exact", {}), flow.get("rate_eu_per_tick_exact", {}))]
			if direction == "output" && chance_outputs:
				row.tooltip_text += " expected from the recipe's recorded probability"
			var tint := Color("d5a36a") if flow.resource == "energy:eu" else Color("7fb9b1")
			set_slot(slot, direction == "input", 0, tint, direction == "output", 0, tint)
			if direction == "input":
				_input_colors[slot] = tint
				input_ports[flow.resource] = input_ports.size()
			else:
				_output_colors[slot] = tint
				output_ports[flow.resource] = output_ports.size()
	tooltip_text = "%s\n%s\n%s\n%s" % [title, summary.text, loadout.text, line.machine]


func configure_endpoint(endpoint: Dictionary, resources: Dictionary[String, String]) -> void:
	recipe_id = endpoint.key
	allocation.assign({"recipe": recipe_id, "configuration": recipe_id, "machines": 0})
	var resource: String = endpoint.resource
	var incoming: bool = endpoint.kind not in ["external", "gap"]
	match endpoint.kind:
		"external":
			title = "External supply"
			loadout.text = "Configured in Factory settings"
		"goal":
			title = "Requested output"
			loadout.text = "Retained for your production goal"
		"gap":
			title = "Unallocated demand"
			loadout.text = "Numerical balance gap; no supply credited"
		"remainder":
			title = "Flow remainder"
			loadout.text = "Within the calculation's balance tolerance"
		_:
			title = "Surplus output"
			loadout.text = "Available after planned consumption"
	summary.text = resources.get(resource, PlannerDisplay.readable_name(resource))
	throughput.text = PlannerDisplay.graph_flow_rate(resource, endpoint.rate,
		endpoint.get("rate_exact", {}), endpoint.get("rate_eu_per_tick_exact", {}))
	power.text = ""
	custom_minimum_size.x = 230
	var row := flow_scene.instantiate() as Label
	var slot := get_child_count()
	add_child(row)
	row.text = "%s %s" % ["←" if incoming else "→", summary.text]
	row.tooltip_text = "%s\n%s" % [resource, PlannerDisplay.flow_rate(resource, endpoint.rate,
		endpoint.get("rate_exact", {}), endpoint.get("rate_eu_per_tick_exact", {}))]
	var tint := Color("dc8075") if endpoint.kind == "gap" else (
		Color("d5a36a") if resource == "energy:eu" else Color("7fb9b1"))
	set_slot(slot, incoming, 0, tint, !incoming, 0, tint)
	if incoming:
		_input_colors[slot] = tint
		input_ports[resource] = 0
	else:
		_output_colors[slot] = tint
		output_ports[resource] = 0
	tooltip_text = "%s\n%s\n%s" % [title, summary.text, throughput.text]
	if endpoint.has("local_to"):
		title = "External EU"
		summary.hide()
		loadout.hide()
		power.hide()
		row.text = "Supply to this line"
		custom_minimum_size.x = 170
		clear_slot(slot)
		set_slot(1, false, 0, tint, true, 0, tint)
		_output_colors.clear()
		_output_colors[1] = tint
		tooltip_text += "\nThis line's share of the configured external supply; not an extra source."


func configure_storage(unit: Dictionary, resources: Dictionary[String, String]) -> void:
	recipe_id = "planner:storage|" + str(unit.machine)
	allocation.assign({"recipe": recipe_id, "configuration": recipe_id, "machine": unit.machine,
		"machines": unit.machines})
	title = PlannerDisplay.machine_name(unit.machine, resources)
	summary.text = "%d × %s" % [int(unit.machines), title]
	loadout.text = "Lossless power buffer"
	throughput.text = "%s EU capacity · %s EU planned charge" % [PlannerDisplay.number(unit.capacity_eu), PlannerDisplay.number(unit.initial_charge_eu)] if unit.has("initial_charge_eu") else "%s EU capacity · %s EU saved" % [PlannerDisplay.number(unit.capacity_eu), PlannerDisplay.number(int(unit.get("imported_saved_charge_eu", "0")))]
	power.text = "%s EU/t charge · %s EU/t discharge" % [PlannerDisplay.number(unit.charge_eu_per_tick), PlannerDisplay.number(unit.discharge_eu_per_tick)]
	if unit.has("initial_charge_eu"):
		var connection := flow_scene.instantiate() as Label
		var slot := get_child_count()
		add_child(connection)
		connection.text = "← Electricity · dispatch buffer"
		connection.tooltip_text = "This link shows that generation can charge storage. It is not an extra sustained demand."
		var tint := Color("d5a36a")
		set_slot(slot, true, 0, tint, false, 0, tint)
		_input_colors[slot] = tint
		input_ports["energy:eu"] = 0
	tooltip_text = "%s\nSaved charge is a starting quantity, not a sustained source.\nPower transfer depends on the player's cable network." % title


func set_flow_emphasis(alpha: float) -> void:
	for slot: int in _input_colors:
		var color: Color = _input_colors[slot]
		color.a = alpha
		set_slot_color_left(slot, color)
	for slot: int in _output_colors:
		var color: Color = _output_colors[slot]
		color.a = alpha
		set_slot_color_right(slot, color)
