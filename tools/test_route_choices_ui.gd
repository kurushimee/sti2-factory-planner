extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(180.0).timeout.connect(func() -> void:
		push_error("Route choice check timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._filter_recipes("processing unit")
	var selected: PackedInt32Array = workspace.recipes_list.get_selected_items()
	assert(!selected.is_empty())
	var recipe_id: String = workspace.recipes_list.get_item_metadata(selected[0])
	assert(recipe_id == ("minecraft:crafting_shaped|"
		+ "modern_industrialization:electric_age/circuit/craft/processing_unit_asbl"))
	(workspace.get_node("%Rate") as SpinBox).value = 0.2
	(workspace.get_node("%AddGoal") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.exact_production.status == "exact")
	var power: Dictionary = workspace._last_result.power
	assert(power.production_peak_eu_per_tick > power.consumption_eu_per_tick)
	assert(str(power.production_peak_eu_per_tick_exact.display).is_valid_int())
	assert(power.production_peak_missing_lines == 0)
	var blue_resource := "item:minecraft:blue_dye"
	var benzene := "modern_industrialization:mixer|modern_industrialization:dyes/blue/mixer/benzene"
	var blue_node: PlannerRecipeNode = _find_resource_node(workspace, blue_resource)
	assert(blue_node != null)
	workspace._select_node(blue_node)
	assert(blue_node.get_meta("relation") == "selected")
	assert(workspace._nodes.values().any(func(node: PlannerRecipeNode) -> bool:
		return node.get_meta("relation") == "supplier"))
	assert(workspace._nodes.values().any(func(node: PlannerRecipeNode) -> bool:
		return node.get_meta("relation") == "consumer"))
	var context: Dictionary = workspace._inspector_context(blue_node)
	assert(!context.incoming.is_empty() && !context.outgoing.is_empty())
	assert(context.routes.any(func(route: Dictionary) -> bool: return route.resource == blue_resource))
	workspace._jump_to_node(context.outgoing[0].key)
	assert(workspace._inspected_key == context.outgoing[0].key)
	workspace._open_route_choice(blue_resource)
	assert((workspace.get_node("%ChoiceDialog") as Window).visible)
	assert(_choice_index(workspace, benzene) >= 0)
	var choice_list := workspace.get_node("%ChoiceList") as ItemList
	for index: int in choice_list.item_count:
		if "Replicate" in choice_list.get_item_text(index):
			assert(choice_list.is_item_disabled(index))
	(workspace.get_node("%ChoiceList") as ItemList).select(_choice_index(workspace, benzene), true)
	workspace._apply_choice()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.routes[blue_resource] == benzene)
	assert(workspace._last_result.exact_production.status == "exact")
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool:
		return line.recipe == benzene))
	assert(workspace._request.goals.size() == 1)
	var glass := "modern_industrialization:furnace|minecraft:/glass_exported_mi_furnace"
	var glass_node: PlannerRecipeNode = _find_recipe_node(workspace, glass)
	assert(glass_node != null)
	workspace._select_node(glass_node)
	assert(workspace._inspector_context(glass_node).ingredients.any(func(choice: Dictionary) -> bool:
		return choice.slot == 0))
	workspace._open_ingredient_choice(glass, 0)
	var sand := "item:minecraft:sand"
	assert(_choice_index(workspace, sand) >= 0)
	(workspace.get_node("%ChoiceList") as ItemList).select(_choice_index(workspace, sand), true)
	workspace._apply_choice()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.ingredients[glass + "#0"] == sand)
	assert(workspace._last_result.exact_production.status == "exact")
	var chosen_glass: PlannerRecipeNode = _find_recipe_node(workspace, glass)
	assert(chosen_glass != null)
	assert(chosen_glass.allocation.ingredient_choices.any(func(choice: Dictionary) -> bool:
		return choice.slot == 0 && choice.resource == sand && choice.rate > 0))
	(workspace.get_node("%Undo") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(!workspace._request.get("ingredients", {}).has(glass + "#0"))
	assert(workspace._request.routes[blue_resource] == benzene)
	workspace._show_power()
	assert(workspace.inspector_cards.visible)
	assert(workspace.inspector_cards.content.get_children().any(func(child: Node) -> bool:
		return child is Label && child.text == "Factory totals"))
	var goal_resource: String = workspace._request.goals[0].resource
	workspace._open_route_choice(goal_resource)
	(workspace.get_node("%ChoiceList") as ItemList).select(_choice_index(workspace, ""), true)
	workspace._apply_choice()
	assert(!workspace._request.goals[0].has("recipe"))
	workspace.computation.cancel()
	print("Route and ingredient choices, plan power, inspector links, highlights, and undo passed.")
	quit()


func _find_resource_node(workspace: PlannerWorkspace, resource: String) -> PlannerRecipeNode:
	for node: PlannerRecipeNode in workspace._nodes.values():
		if !node.has_meta("flow_endpoint") && workspace._recipes[node.recipe_id].primary == resource:
			return node
	return null


func _find_recipe_node(workspace: PlannerWorkspace, recipe_id: String) -> PlannerRecipeNode:
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == recipe_id:
			return node
	return null


func _choice_index(workspace: PlannerWorkspace, id: String) -> int:
	var choices := workspace.get_node("%ChoiceList") as ItemList
	for index: int in choices.item_count:
		if choices.get_item_metadata(index) == id:
			return index
	return -1
