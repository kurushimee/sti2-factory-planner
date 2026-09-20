class_name PlannerRecipeNode
extends GraphNode

@onready var summary: Label = %Summary
@onready var throughput: Label = %Throughput
@onready var power: Label = %Power

@export var flow_scene: PackedScene

var recipe_id := ""
var allocation: Dictionary[String, Variant] = {}
var input_ports: Dictionary[String, int] = {}
var output_ports: Dictionary[String, int] = {}


func configure(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String]) -> void:
	recipe_id = recipe.id
	allocation.assign(line)
	title = recipe.get("name", recipe.id)
	summary.text = "%d × %s" % [int(line.machines), line.machine]
	throughput.text = "%s operations/s" % String.num(line.operations_per_second, 3)
	power.text = "%s EU/t  ·  %s%% utilized" % [String.num(line.power_eu_per_tick, 2), String.num(line.utilization * 100, 1)]
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
			row.text = "%s %s  ·  %s /s" % ["←" if direction == "input" else "→", label, String.num(flow.rate, 3)]
			var tint := Color("d5a36a") if flow.resource == "energy:eu" else Color("7fb9b1")
			set_slot(slot, direction == "input", 0, tint, direction == "output", 0, tint)
			if direction == "input":
				input_ports[flow.resource] = input_ports.size()
			else:
				output_ports[flow.resource] = output_ports.size()
	tooltip_text = "%s\n%s" % [title, summary.text]
