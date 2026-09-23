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
	var collision: Dictionary = PlannerJson.parse('{"\\u0001number:0":"\\u0001number:0","value":1.9104477611940298}')
	assert(collision["\u0001number:0"] == "\u0001number:0")
	var duplicate: Dictionary = PlannerJson.parse('{"value":1.0,"value":1.9104477611940298}')
	assert(duplicate.value == collision.value)
	var storage := PackedByteArray()
	storage.resize(8)
	storage.encode_double(0, collision.value)
	assert(storage.hex_encode() == "67b7f0ab3191fe3f")
	var zeros: Array = PlannerJson.parse("[0.0,-0.0]")
	storage.encode_double(0, zeros[0])
	assert(storage.hex_encode() == "0000000000000000")
	storage.encode_double(0, zeros[1])
	assert(storage.hex_encode() == "0000000000000080")
	var arguments := OS.get_cmdline_user_args()
	if !arguments.is_empty():
		var cases: Array = JSON.parse_string(FileAccess.get_file_as_string(arguments[0]))
		for sample: Dictionary in cases:
			storage.encode_double(0, PlannerJson.parse(sample.text))
			assert(storage.hex_encode() == sample.bits, "Incorrect rounding for %s." % sample.text)
		print("%d independent decimal bit checks passed." % cases.size())
	print("JSON decimals preserve magnitude and significant digits without changing quoted strings.")
	quit()
