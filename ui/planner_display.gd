class_name PlannerDisplay
extends RefCounted


static func input_value(control: SpinBox) -> float:
	# Range steps can introduce binary noise beyond the decimals shown to the player.
	return float(PlannerJson.parse(String.num(control.value, step_decimals(control.step))))


static func readable_name(identity: String, supplied: String = "") -> String:
	var untyped := identity.trim_prefix("item:").trim_prefix("fluid:")
	if !supplied.is_empty() && supplied != identity && supplied.replace(" ", "_") != untyped && !supplied.begins_with("item.") && !supplied.begins_with("fluid.") && !supplied.begins_with("block."):
		return supplied
	var base := identity.get_slice("#", 0)
	var words := base.get_slice(":", base.get_slice_count(":") - 1).replace("_", " ").capitalize()
	if identity.contains("#"):
		words += " · " + identity.get_slice("#", 1).left(6)
	return words.replace("Uu ", "UU ")


static func recipe_name(recipe: Dictionary) -> String:
	return readable_name(recipe.get("primary", recipe.id), recipe.get("name", ""))


static func machine_name(identity: String, resources: Dictionary[String, String]) -> String:
	return readable_name(identity, resources.get("item:" + identity, ""))


static func number(value: float) -> String:
	if value != 0.0 && absf(value) < 0.001:
		var exponent := floori(log(absf(value)) / log(10.0))
		return String.num(value / pow(10.0, exponent), 3) + "e" + str(exponent)
	for unit: Array in [[1.0e15, "P"], [1.0e12, "T"], [1.0e9, "G"], [1.0e6, "M"], [1.0e3, "k"]]:
		if absf(value) >= unit[0]:
			return String.num(value / unit[0], 3) + " " + unit[1]
	return String.num(value, 3)


static func flow_rate(resource: String, rate: float) -> String:
	if resource == "energy:eu":
		return number(rate / 20.0) + " EU/t"
	return number(rate) + (" mB/s" if resource.begins_with("fluid:") else " /s")


static func loadout(configuration: Dictionary, resources: Dictionary[String, String]) -> String:
	var setup: Dictionary = configuration.get("setup", {})
	var count := int(setup.get("upgrade_count", 0))
	var text := "%d × %s per machine" % [count, machine_name(str(setup.get("upgrade", {}).get("id", "upgrade")), resources)] if count else "No upgrades"
	if setup.get("contained_count", 0):
		text += "\n%d × %s inside each array" % [setup.contained_count, machine_name(str(setup.get("contained_machine", "machine")), resources)]
	if setup.get("batch", 1) > 1:
		text += "\n%d operations per batch" % setup.batch
	return text


static func markup(value: String) -> String:
	return value.replace("[", "[lb]")


static func optimization_report(result: Dictionary) -> String:
	var details: Dictionary = result.get("optimization", {})
	if details.is_empty():
		return ""
	var text := "[font_size=20]Calculation result[/font_size]\n\n"
	text += "Lowest cost proven for the configured priorities.\n" if result.get("optimal", false) else "Feasible plan. The lowest cost has not been proven.\n"
	text += "Weighted cost: %s\n" % number(details.get("objective", 0.0))
	if details.get("lower_bound") != null:
		text += "Proven cost bound: %s\n" % number(details.lower_bound)
	if !result.get("optimal", false) && details.get("relative_gap") != null:
		text += "Further search could reduce this cost by at most %s%%.\n" % String.num(details.relative_gap * 100.0, 1)
	text += "Costs use your resource, machine, upgrade, and energy priorities. They are not item counts.\n"
	if result.get("search", {}).get("method") == "relaxed_route_repair":
		text += "This large plan uses a continuous-flow estimate, resolves route conflicts, and rechecks whole-machine capacity and every resource balance. Its route search is a heuristic.\n"
	elif result.get("search", {}).get("method") == "material_cost_refinement":
		text += "Production routes, machines, and upgrades use complete construction recipes. A change is accepted only after checking its production and construction balances and total cost.\n"
		for comparison: Dictionary in result.get("search", {}).get("material_comparisons", []):
			text += "%s: %d routes and %d loadouts. " % ["Alternative search" if comparison.scope == "alternative_routes" else "Initial route search", int(comparison.recipes), int(comparison.configurations)]
			if comparison.get("selected", false):
				text += "It found a cheaper verified plan.\n"
			elif comparison.get("verified", false):
				text += "The candidate did not improve the complete cost.\n"
			else:
				text += "It did not establish a replacement; the earlier verified plan is retained.\n"
		text += "Alternative routes use a limited set of loadouts. Other choices may cost less; no global cost bound is available.\n"
	elif result.get("search", {}).get("method") == "precision_recovery":
		text += "Small flows were rechecked with rescaled equations. Whole-machine capacity and resource balances pass, but this numerical retry does not establish the lowest cost.\n"
	var preferences: Dictionary = result.get("recipe_preferences", {})
	if preferences.get("fallback", false):
		text += "The preferred equal-material routes did not yield a verified plan in this search. Available alternatives were retained.\n"
	elif !preferences.get("applied", []).is_empty():
		text += "Available equal-material route preferences are applied. Select a recipe node to see why its route was preferred.\n"
	return text + "\n"


static func power_report(power: Dictionary, resources: Dictionary = {}, construction: Dictionary = {}) -> String:
	if power.is_empty():
		return "Add a goal to calculate factory power."
	var text := "[font_size=20]Factory power[/font_size]\n\n[b]Running generation[/b]\n"
	for entry: Array in [["Gross generation", "gross_generation_eu_per_tick"], ["Generation and fuel-chain use", "generation_related_consumption_eu_per_tick"], ["Net generation", "net_generation_eu_per_tick"], ["External supply", "external_eu_per_tick"]]:
		text += "%s\n[b]%s EU/t[/b]\n" % [entry[0], number(power.get(entry[1], 0))]
	text += "\n[b]Factory demand[/b]\n"
	for entry: Array in [["Other production", "other_production_consumption_eu_per_tick"], ["Infrastructure and power goals", "infrastructure_and_goal_eu_per_tick"], ["Remaining running margin", "operating_margin_eu_per_tick"]]:
		text += "%s\n[b]%s EU/t[/b]\n" % [entry[0], number(power.get(entry[1], 0))]
	text += "\n[b]Installed capacity[/b]\n%s EU/t generation\n%s EU/t available margin\n%s%% requested reserve\n" % [number(power.installed_generation_eu_per_tick), number(power.installed_margin_eu_per_tick), number(float(power.reserve_fraction) * 100)]
	var infrastructure: Dictionary = power.get("infrastructure", {})
	if !infrastructure.get("entries", []).is_empty():
		text += "\n[b]Configured infrastructure[/b]\n%s EU/t manual overhead\n" % number(infrastructure.manual_eu_per_tick)
		for entry: Dictionary in infrastructure.entries:
			text += "\n%s × %s\n%s EU/t added drain\n" % [number(entry.count), markup(entry.name), number(entry.passive_eu_per_tick)]
			text += "%s EU/t planned transfer per tower\n" % number(entry.get("transmit_eu_per_tick_per_machine", 0))
			if entry.get("transfer_eu_per_tick_per_machine") != null:
				text += "%s EU/t transfer limit per machine\n" % number(entry.transfer_eu_per_tick_per_machine)
			if entry.get("max_axis_distance") != null:
				text += "%s blocks of range along each axis\n" % number(entry.max_axis_distance)
			for assumption: String in entry.assumptions:
				text += markup(assumption) + "\n"
			text += markup(entry.construction_status) + "\n"
			if entry.get("structure", {}).get("status") == "sized":
				text += "\n[b]Build requirements per tower[/b]\n"
				for part: Dictionary in entry.structure.build_requirements:
					text += "%s × %s\n" % [number(part.amount), markup(resources.get(part.resource, readable_name(part.resource)))]
				for assumption: String in entry.structure.assumptions:
					text += markup(assumption) + "\n"
	var periodic: Dictionary = power.get("periodic", {})
	if !periodic.is_empty():
		text += "\n[b]Periodic generation and storage[/b]\n%s ticks per modeled cycle\n" % number(periodic.period_ticks)
		for source: Dictionary in periodic.generation:
			text += "%s × %s: %s EU/t nominal cycle average; %s EU/t after a possible output gap\n" % [number(source.machines), markup(resources.get("item:" + str(source.machine), readable_name(source.machine))), number(source.nominal_average_eu_per_tick), number(source.guaranteed_average_eu_per_tick)]
		for unit: Dictionary in periodic.storage:
			text += "%s × %s: %s EU capacity, %s EU/t charge and %s EU/t discharge\n" % [number(unit.machines), markup(resources.get("item:" + str(unit.machine), readable_name(unit.machine))), number(unit.capacity_eu), number(unit.charge_eu_per_tick), number(unit.discharge_eu_per_tick)]
			text += "%s EU planned initial charge; %s EU at cycle end\n" % [number(unit.initial_charge_eu), number(unit.ending_charge_eu)]
		if periodic.event_buffer_eu > 0:
			text += "%s EU of storage is reserved for uncertain generation gaps.\n" % number(periodic.event_buffer_eu)
		text += "%s EU of modeled output is curtailed per cycle.\n" % number(periodic.curtailed_generation_eu_per_period)
		for assumption: String in periodic.assumptions:
			text += markup(assumption) + "\n"
	text += "\n" + markup(power.get("reserve_basis", "")) + " External supply contributes to installed reserve only when it has a declared firm capacity.\n\n" + markup(power.get("attribution_basis", ""))
	text += "\n\nSustained values assume continuous supplies. Inspect each machine for its peak draw and startup stocks. Installed margin does not establish that every machine can start at once."
	text += construction_report(construction, resources)
	return text


static func inspection(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String], startup: Dictionary, construction: Dictionary = {}) -> String:
	var configuration: Dictionary = line.get("configuration_details", {})
	var capacity: Dictionary = configuration.get("capacity", {})
	var title := readable_name(recipe.primary, recipe.get("name", ""))
	var text := "[font_size=20]%s[/font_size]\n\n[b]%d × %s[/b]\n%s\n" % [markup(title), int(line.machines), markup(machine_name(line.machine, resources)), markup(loadout(configuration, resources))]
	if line.has("route_preference"):
		text += "\n[b]Route choice[/b]\n%s\n" % markup(line.route_preference.reason)
	for section: String in ["Production", "Ingredients"]:
		text += "\n[b]%s[/b]\n" % section
		var flows: Array = line.outputs if section == "Production" else line.inputs
		if flows.is_empty():
			text += "None\n"
		for flow: Dictionary in flows:
			text += "%s · %s\n" % [markup(resources.get(flow.resource, readable_name(flow.resource))), flow_rate(flow.resource, flow.rate)]
	text += "\n[b]Capacity and power[/b]\n%s operations/s installed\n%s%% utilization\nMachine draw: %s EU/t sustained\n" % [number(line.capacity_per_second), number(line.utilization * 100), number(line.power_eu_per_tick)]
	if capacity.has("ticks_per_batch"):
		var energy_resource: String = configuration.get("capacity_input", {}).get("machine", {}).get("energy_resource", "energy:eu")
		var energy_unit: String = "EU" if energy_resource == "energy:eu" else "mB " + resources.get(energy_resource, readable_name(energy_resource))
		text += "%s ticks per batch at full speed\n%s %s per operation\n%s %s/t peak per machine\n" % [number(capacity.ticks_per_batch), number(capacity.get("eu_per_operation", 0)), energy_unit, number(capacity.get("peak_eu_per_tick", 0)), energy_unit]
		if capacity.get("warmup_ticks") != null:
			text += "%s s to full-speed operation\n" % number(float(capacity.warmup_ticks) / 20.0)
	var discovery_ticks: float = configuration.get("startup_profile", {}).get("discovery_delay_ticks", 0)
	if discovery_ticks > 0:
		text += "Up to %s s for initial source discovery\n" % number(discovery_ticks / 20.0)
	var process: Dictionary = recipe.get("process", {})
	if !process.is_empty():
		text += "Recipe: %s ticks at %s EU/t before machine modifiers\n" % [number(process.get("duration_ticks", 0)), number(process.get("eu_per_tick", 0))]
	var structure: Dictionary = configuration.get("structure", {})
	if !configuration.get("build_requirements", []).is_empty():
		text += "\n[b]Build requirements per machine[/b]\n"
		for part: Dictionary in configuration.build_requirements:
			text += "%s × %s\n" % [number(part.amount), markup(resources.get(part.resource, readable_name(part.resource)))]
	if structure.get("status") == "unsupported":
		text += "Structure incomplete: " + markup(structure.reason) + "\n"
	elif structure.get("status") == "sized":
		text += "Hatches hold a full batch and meet the stated power limits. Selection minimizes hatch count; material-cost optimization is not included.\n"
	var key := String(line.recipe) + "|" + String(line.configuration)
	var stock_text := ""
	for stock: Dictionary in startup.get("resources", []):
		if key in stock.get("origins", []):
			stock_text += "%s · %s%s\n" % [markup(resources.get(stock.resource, readable_name(stock.resource))), number(stock.quantity), " mB" if String(stock.resource).begins_with("fluid:") else ""]
	if !stock_text.is_empty():
		text += "\n[b]Startup stocks[/b]\n" + stock_text + "Factory totals for resources used by this line. Conservative cold-start reserves include other consumers.\n"
	var assumptions: Array = configuration.get("assumptions", []).duplicate()
	assumptions.append_array(structure.get("assumptions", []))
	if recipe.get("expected_yields", false):
		assumptions.append("Probabilistic outputs use expected yields. Actual deliveries vary.")
	for condition: Dictionary in recipe.get("conditions", []):
		assumptions.append("Required condition: " + JSON.stringify(condition))
	if !assumptions.is_empty():
		text += "\n[b]Assumptions and conditions[/b]\n"
		for assumption: String in assumptions:
			text += markup(assumption) + "\n"
	text += construction_report(construction, resources)
	text += "\n[b]Recipe source[/b]\n[font_size=12]%s\n%s[/font_size]" % [markup(recipe.get("source_id", recipe.id)), markup(recipe.get("origin", "Custom dataset"))]
	return text


static func construction_report(construction: Dictionary, resources: Dictionary) -> String:
	if construction.is_empty():
		return ""
	var text := ""
	text += "\n[b]Factory construction estimate[/b]\n%s material cost units\n%s machine-seconds of construction work\n%s EU for construction\n" % [number(construction.material_cost), number(construction.work_seconds), number(construction.energy_eu)]
	text += "Whole recipe batches and purchased items for the factory. Random yields remain expected values.\n" if construction.method == "whole_batches" else "Unrounded material equivalents for the whole factory.\n"
	text += "These quantities are separate from operating flow rates.\n\n[b]Purchased construction supplies[/b]\n"
	for supply: Dictionary in construction.external:
		text += "%s × %s · %s cost each\n" % [number(supply.amount), markup(resources.get(supply.resource, readable_name(supply.resource))), number(supply.unit_cost)]
	text += "\n[b]Construction recipe work[/b]\n"
	for route: Dictionary in construction.routes:
		text += "%s operations · %s\n" % [number(route.operations), markup(route.get("name", route.recipe))]
	if !construction.get("tools", []).is_empty():
		text += "\n[b]Consumable construction tools[/b]\n"
		for tool: Dictionary in construction.tools:
			text += "%s × %s · %s crafts remain after this job\n" % [number(tool.count), markup(resources.get(tool.resource, readable_name(tool.resource))), number(tool.remaining_crafts)]
	for assumption: String in construction.assumptions:
		text += "\n" + markup(assumption) + "\n"
	return text
