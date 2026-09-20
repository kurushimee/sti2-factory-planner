extends SceneTree


func _initialize() -> void:
	var entries: Array[PlannerGraphLayout.Entry] = []
	for key: String in ["a", "b", "c", "d"]:
		entries.append(PlannerGraphLayout.Entry.new(key, "Metals", Vector2(280, 210)))
	entries.append(PlannerGraphLayout.Entry.new("power", "Power", Vector2(310, 250)))
	var flows: Array = [{"source": "a", "destination": "b", "resource": "iron"}, {"source": "b", "destination": "c", "resource": "iron"}, {"source": "c", "destination": "b", "resource": "return"}, {"source": "c", "destination": "d", "resource": "steel"}, {"source": "power", "destination": "a", "resource": "energy:eu"}]
	var layout := PlannerGraphLayout.arrange(entries, flows)
	assert(layout.positions.a.x < layout.positions.b.x)
	assert(layout.positions.b.x == layout.positions.c.x)
	assert(layout.positions.c.x < layout.positions.d.x)
	assert(layout.positions.b.y != layout.positions.c.y)
	for first: PlannerGraphLayout.Entry in entries:
		var rect := Rect2(layout.positions[first.key], first.size)
		assert(layout.groups[first.group].encloses(rect))
		for second: PlannerGraphLayout.Entry in entries:
			if first.key != second.key:
				assert(!rect.intersects(Rect2(layout.positions[second.key], second.size)))
	entries.reverse()
	assert(PlannerGraphLayout.arrange(entries, flows).positions == layout.positions)
	entries.clear()
	flows.clear()
	for index: int in 10000:
		entries.append(PlannerGraphLayout.Entry.new(str(index), "Recycling", Vector2(280, 210)))
		flows.append({"source": str(index), "destination": str((index + 1) % 10000), "resource": "return"})
	var start := Time.get_ticks_msec()
	layout = PlannerGraphLayout.arrange(entries, flows)
	assert(layout.positions.size() == 10000)
	assert(layout.positions["0"].x == layout.positions["9999"].x)
	print("Layout passed ordering, recycling cycles, non-overlap, stable grouping, and a 10,000-node cycle in %d ms." % (Time.get_ticks_msec() - start))
	quit()
