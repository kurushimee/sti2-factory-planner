extends SceneTree


func _initialize() -> void:
	var rate := 1.0 / 3600.0
	var original := {"rate": rate, "small": 0.001, "zero": 0.0, "negative": -rate,
		"text": 'Quoted "0.0002777777777777778" and a backslash \\ stay unchanged.'}
	var parsed: Dictionary = PlannerJson.parse(JSON.stringify(original, "", true, true))
	assert(parsed.rate == rate)
	assert(parsed.negative == -rate)
	assert(parsed.small == original.small)
	assert(parsed.zero == 0.0)
	assert(parsed.text == original.text)
	assert(PlannerJson.parse("[0.001e3, -0.00025E+4, 0.000000000000000001]") == [1.0, -2.5, 1e-18])
	assert(PlannerJson.parse('"0.0002777777777777778"') == "0.0002777777777777778")
	assert(PlannerJson.parse("600.0000000000001") == 600.0000000000001)
	assert(PlannerJson.parse("[12345.678901234567, -600.0000000000001, 0.0, 123.0e-7]") == [12345.678901234567, -600.0000000000001, 0.0, 0.0000123])
	print("JSON decimals preserve magnitude and significant digits without changing quoted strings.")
	quit()
