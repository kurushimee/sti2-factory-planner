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


func configure(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String]) -> void:
	recipe_id = recipe.id
	allocation.assign(line)
	title = PlannerDisplay.readable_name(recipe.primary, recipe.get("name", ""))
	if title.length() > 44:
		title = title.left(41) + "…"
	summary.text = "%d × %s" % [int(line.machines), PlannerDisplay.machine_name(line.machine, resources)]
	loadout.text = PlannerDisplay.loadout(line.get("configuration_details", {}), resources)
	var chance_outputs: bool = recipe.get("outputs", []).any(func(output: Dictionary) -> bool:
		return output.get("probability", 1) != 1)
	var operations := PlannerDisplay.number(line.operations_per_second)
	throughput.text = "%s operations/s" % operations
	if chance_outputs:
		throughput.text = "%s ops/s · expected yields" % operations
	power.text = "%s EU/t  ·  %s%% utilized" % [PlannerDisplay.number(line.power_eu_per_tick), PlannerDisplay.number(line.utilization * 100)]
	var inputs: Array = line.inputs.duplicate(true)
	if line.power_eu_per_tick > 0:
		inputs.append({"resource": "energy:eu", "rate": line.power_eu_per_tick * 20})
	for direction: String in ["input", "output"]:
		var flows: Array = inputs if direction == "input" else line.outputs
		for flow: Dictionary in flows:
			var row := flow_scene.instantiate() as Label
			var slot := get_child_count()
			add_child(row)
			var label: String = resources.get(flow.resource, flow.resource)
			row.text = "%s %s  ·  %s" % ["←" if direction == "input" else "→", label, PlannerDisplay.flow_rate(flow.resource, flow.rate)]
			row.tooltip_text = "%s\n%s per second" % [flow.resource, str(flow.rate)]
			if direction == "output" && chance_outputs:
				row.tooltip_text += " expected from the recipe's recorded probability"
			var tint := Color("d5a36a") if flow.resource == "energy:eu" else Color("7fb9b1")
			set_slot(slot, direction == "input", 0, tint, direction == "output", 0, tint)
			if direction == "input":
				input_ports[flow.resource] = input_ports.size()
			else:
				output_ports[flow.resource] = output_ports.size()
	tooltip_text = "%s\n%s\n%s\n%s" % [title, summary.text, loadout.text, line.machine]


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
		input_ports["energy:eu"] = 0
	tooltip_text = "%s\nSaved charge is a starting quantity, not a sustained source.\nPower transfer depends on the player's cable network." % title
