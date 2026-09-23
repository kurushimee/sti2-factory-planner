class_name PlannerDatasetValidation
extends RefCounted


static func check(value: Variant) -> String:
	if !(value is Dictionary) || !_version(value.get("format")) || !(value.get("resources") is Array) || !(value.get("recipes") is Array):
		return "This file is not a supported planning dataset."
	var resources: Dictionary[String, bool] = {}
	var catalog_ids: Dictionary = {"machines": {}, "upgrades": {}}
	for resource: Variant in value.resources:
		if !(resource is Dictionary) || !(resource.get("id") is String) || resource.id.is_empty():
			return "Every resource needs a nonempty text ID."
		if resources.has(resource.id):
			return "Duplicate resource ID: %s" % resource.id
		if resource.has("max_stack_size") && (!_positive(resource.max_stack_size) || resource.max_stack_size < 1 || floor(resource.max_stack_size) != resource.max_stack_size):
			return "Resource %s needs a positive whole stack limit." % resource.id
		resources[resource.id] = true
	for field: String in ["machines", "upgrades"]:
		if !(value.get(field, []) is Array):
			return "The dataset's %s field must be a list." % field
		var ids: Dictionary[String, bool] = {}
		for record: Variant in value.get(field, []):
			if !(record is Dictionary) || !(record.get("id") is String) || record.id.is_empty():
				return "Every %s entry needs a text ID." % field
			if ids.has(record.id):
				return "Duplicate %s ID: %s" % [field, record.id]
			ids[record.id] = true
			if field == "machines" && record.has("availability"):
				if !(record.availability is Dictionary) || !(record.availability.get("automatic") is bool) || !(record.availability.get("reason") is String):
					return "Machine %s needs a valid availability flag and reason." % record.id
			if field == "machines" && record.get("mechanic") == "energy_storage":
				if record.get("status") != "infrastructure" || !(record.get("storage") is Dictionary):
					return "Storage machine %s needs an infrastructure rule." % record.id
				for amount: String in ["capacity_eu", "charge_eu_per_tick", "discharge_eu_per_tick"]:
					if !_positive(record.storage.get(amount)) || floor(record.storage[amount]) != record.storage[amount]:
						return "Storage machine %s needs a positive whole %s." % [record.id, amount]
				if !_nonnegative(record.storage.get("loss_eu_per_tick")) || floor(record.storage.loss_eu_per_tick) != record.storage.loss_eu_per_tick || !(record.storage.get("saved_charge_field") is String) || record.storage.saved_charge_field.is_empty():
					return "Storage machine %s needs a valid loss and saved-charge rule." % record.id
		catalog_ids[field] = ids
	if !_string_list(value.get("default_machines", [])):
		return "Default machines must be a list of text IDs."
	var recipes: Dictionary[String, bool] = {}
	for recipe: Variant in value.recipes:
		if !(recipe is Dictionary) || !(recipe.get("id") is String) || recipe.id.is_empty():
			return "Every recipe needs a nonempty text ID."
		if recipes.has(recipe.id):
			return "Duplicate recipe ID: %s" % recipe.id
		recipes[recipe.id] = true
		if recipe.has("unsupported") && !(recipe.unsupported is String):
			return "Recipe %s needs a text explanation of unsupported behavior." % recipe.id
		if recipe.has("process") && !(recipe.process is Dictionary):
			return "Recipe %s has an invalid process." % recipe.id
		if !(recipe.get("primary") is String) || !resources.has(recipe.primary):
			return "Recipe %s has an unknown primary output." % recipe.id
		for direction: String in ["inputs", "outputs"]:
			if !(recipe.get(direction) is Array):
				return "Recipe %s needs an %s list." % [recipe.id, direction]
			for flow: Variant in recipe[direction]:
				if !(flow is Dictionary) || !_positive(flow.get("amount")):
					return "Recipe %s has an invalid resource quantity." % recipe.id
				var choices: Variant = flow.get("choices", [flow.get("resource")])
				if !(choices is Array) || choices.is_empty():
					return "Recipe %s has an empty ingredient choice." % recipe.id
				for resource: Variant in choices:
					if !(resource is String) || !resources.has(resource):
						return "Recipe %s references an unknown resource." % recipe.id
				if direction == "outputs" && !(flow.get("resource") is String):
					return "Recipe %s needs concrete output resources." % recipe.id
		if recipe.outputs.is_empty() || !(recipe.get("configurations") is Array):
			return "Recipe %s needs outputs and a configuration list." % recipe.id
		for configuration: Variant in recipe.configurations:
			if !(configuration is Dictionary) || !(configuration.get("id") is String) || !(configuration.get("machine") is String) || !_positive(configuration.get("operations_per_second")):
				return "Recipe %s has an invalid machine configuration." % recipe.id
			catalog_ids.machines[configuration.machine] = true
	if !(value.get("route_preferences", []) is Array):
		return "Route preferences must be a list."
	for preference: Variant in value.get("route_preferences", []):
		if !(preference is Dictionary) || !(preference.get("preferred") is String) || !(preference.get("alternative") is String) || !(preference.get("reason") is String):
			return "Every route preference needs two recipe IDs and an explanation."
		if !recipes.has(preference.preferred) || !recipes.has(preference.alternative) || preference.reason.is_empty():
			return "A route preference references a missing recipe or explanation."
	if !(value.get("progression", []) is Array):
		return "Progression presets must be a list."
	var preset_ids: Dictionary[String, bool] = {}
	for preset: Variant in value.get("progression", []):
		if !(preset is Dictionary) || !(preset.get("id") is String) || preset.id.is_empty() || !(preset.get("name") is String) || preset.name.is_empty():
			return "Every progression preset needs an ID and a name."
		if preset_ids.has(preset.id):
			return "Progression preset IDs must be unique."
		preset_ids[preset.id] = true
		if !_string_list(preset.get("available_parts", [])):
			return "Progression hatch availability must be a list of IDs."
		for id: String in preset.get("available_parts", []):
			if !catalog_ids.machines.has(id):
				return "A progression preset references an unknown hatch ID: " + id
		for field: String in ["machines", "upgrades"]:
			var selected: Variant = preset.get("available_" + field)
			if !_string_list(selected):
				return "Progression presets need machine and upgrade ID lists."
			for id: String in selected:
				if !catalog_ids[field].has(id):
					return "A progression preset references an unknown %s ID: %s" % [field, id]
	return ""


static func check_plan(value: Variant) -> String:
	if !(value is Dictionary) || str(value.get("format")) != "factory-plan" || !_version(value.get("version")):
		return "This file is not a supported factory plan."
	var error := check(value.get("dataset"))
	if !error.is_empty():
		return error
	if value.get("dataset_identity") != value.dataset.get("identity", "custom"):
		return "The plan's dataset identity does not match its embedded data."
	if !(value.get("request") is Dictionary) || !(value.request.get("goals") is Array):
		return "The plan has no valid goal list."
	for field: String in ["available_machines", "disabled_machines", "available_upgrades", "disabled_upgrades", "available_parts", "disabled_recipes", "obtained_resources", "available_dimensions", "available_biomes"]:
		if !_string_list(value.request.get(field, [])):
			return "The plan's %s field must be a list of text IDs." % field
	for field: String in ["weights", "routes", "configurations", "machine_setups", "ingredients", "catalysts", "installed", "limits", "dispatch"]:
		if !(value.request.get(field, {}) is Dictionary):
			return "The plan's %s field must be an object." % field
	if !(value.request.get("external", []) is Array):
		return "External supplies must be a list."
	for supply: Variant in value.request.get("external", []):
		if !(supply is Dictionary) || !(supply.get("resource") is String):
			return "Every external supply needs a resource ID."
		for field: String in ["cost", "limit"]:
			if supply.has(field) && !_nonnegative(supply[field]):
				return "External supply %s must be nonnegative." % field
	for field: String in ["reserve_fraction", "overhead_eu_per_tick"]:
		if value.request.has(field) && !_nonnegative(value.request[field]):
			return "The plan's %s field must be nonnegative." % field
	if !(value.request.get("infrastructure", []) is Array):
		return "Infrastructure must be a list of configured machines."
	for entry: Variant in value.request.get("infrastructure", []):
		if !(entry is Dictionary) || !(entry.get("machine") is String) || !(entry.get("variant") is String) || !_nonnegative(entry.get("count")):
			return "Each infrastructure entry needs a machine, variant, and whole count."
		if float(entry.count) != floorf(float(entry.count)):
			return "Infrastructure counts must be whole numbers."
		if entry.has("id") && (!(entry.id is String) || entry.id.is_empty()):
			return "An infrastructure identifier must be nonempty text."
		if entry.has("energy_hatch") && !(entry.energy_hatch is String):
			return "An infrastructure energy hatch must use a machine ID."
		if entry.has("transmit_eu_per_tick") && !_nonnegative(entry.transmit_eu_per_tick):
			return "Planned infrastructure transfer must be nonnegative."
	for goal: Variant in value.request.goals:
		if !(goal is Dictionary) || !(goal.get("resource") is String):
			return "The plan contains an invalid goal."
		if !(goal.get("kind", "rate") is String):
			return "The goal type must be text."
		var kind: String = goal.get("kind", "rate")
		if !kind in ["rate", "capacity", "quantity"]:
			return "The plan contains an unknown goal type."
		if kind == "capacity":
			if !(goal.get("recipe") is String) || !(goal.get("configuration") is String) || !_positive(goal.get("machines")) || goal.machines != floorf(goal.machines):
				return "A capacity goal needs a recipe, configuration, and whole-machine count."
		elif !_positive(goal.get("rate")):
			return "The goal rate must be positive."
		if kind == "quantity" && !_quantity(goal.get("quantity")):
			return "The production quantity must be positive."
		if !value.dataset.resources.any(func(resource: Dictionary) -> bool: return resource.id == goal.resource):
			return "The plan requests an unknown resource: %s" % goal.resource
	for field: String in ["positions", "groups"]:
		if !(value.get(field, {}) is Dictionary):
			return "The plan's %s field must be an object." % field
	for point: Variant in value.get("positions", {}).values():
		if !_coordinates(point, 2):
			return "The plan contains an invalid node position."
	if value.has("view") && !check_view(value.view).is_empty():
		return check_view(value.view)
	for group: Variant in value.get("groups", {}).values():
		if !(group is Dictionary) || !(group.get("title") is String) || !_coordinates(group.get("rect"), 4):
			return "The plan contains an invalid group boundary."
		if group.rect[2] <= 0 || group.rect[3] <= 0:
			return "Group boundaries must have positive width and height."
	return ""


static func check_view(value: Variant) -> String:
	if !(value is Dictionary) || !_positive(value.get("zoom")) || value.zoom > 100 || !_coordinates(value.get("scroll"), 2) || !(value.get("inspected", "") is String):
		return "The plan contains an invalid workspace view."
	return ""


static func _positive(value: Variant) -> bool:
	return (value is float || value is int) && is_finite(float(value)) && value > 0 && value <= 9007199254740991.0


static func _quantity(value: Variant) -> bool:
	if !(value is String):
		return _positive(value)
	if value.length() > 2000:
		return false
	var expression := RegEx.new()
	expression.compile("^\\+?(\\d+)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$")
	var matched := expression.search(value.strip_edges())
	if !matched:
		return false
	var digits := matched.get_string(1) + matched.get_string(2)
	var exponent := matched.get_string(3)
	if digits.length() > 1000 || exponent.length() > 5 || digits.replace("0", "").is_empty():
		return false
	return absi(exponent.to_int() - matched.get_string(2).length()) <= 1000


static func _nonnegative(value: Variant) -> bool:
	return (value is float || value is int) && is_finite(float(value)) && value >= 0 && value <= 9007199254740991.0


static func _version(value: Variant) -> bool:
	return (value is float || value is int) && value == 1


static func _string_list(value: Variant) -> bool:
	return value is Array && value.all(func(entry: Variant) -> bool: return entry is String)


static func _coordinates(value: Variant, count: int) -> bool:
	if !(value is Array) || value.size() != count:
		return false
	for coordinate: Variant in value:
		if !(coordinate is float || coordinate is int) || !is_finite(float(coordinate)) || absf(float(coordinate)) > 1000000000:
			return false
	return true
