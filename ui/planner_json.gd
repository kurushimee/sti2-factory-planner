class_name PlannerJson
extends RefCounted

const INFINITY_BITS: int = 0x7ff0000000000000
const FRACTION_MASK: int = 0x000fffffffffffff
const LIMB_BASE: int = 10000000
static var _decimal_numbers: RegEx


static func parse(text: String) -> Variant:
	# Check the original syntax before replacing numeric tokens with temporary strings.
	var original: Variant = JSON.parse_string(text)
	if original == null:
		return null
	if _decimal_numbers == null:
		_decimal_numbers = RegEx.new()
		_decimal_numbers.compile('"(?:[^"\\\\]|\\\\.)*"(*SKIP)(*F)|(?<number>-?(?<integer>0|[1-9][0-9]*)(?:\\.(?<fraction>[0-9]+)(?:[eE](?<exponent>[+-]?[0-9]+))?|[eE](?<whole_exponent>[+-]?[0-9]+)))')
	var matched := _decimal_numbers.search(text)
	if matched == null:
		return original
	var marker := "\u0001number:"
	while _contains_marker(original, marker):
		marker += ":"
	original = null
	var values: Array[float] = []
	var cache: Dictionary[String, float] = {}
	var bytes := PackedByteArray()
	var cursor := 0
	while matched:
		bytes.append_array(text.substr(cursor, matched.get_start() - cursor).to_utf8_buffer())
		var token := matched.get_string("number")
		if !cache.has(token):
			var digits := matched.get_string("integer") + matched.get_string("fraction")
			var exponent_text := matched.get_string("exponent") + matched.get_string("whole_exponent")
			var exponent := _decimal_exponent(exponent_text) - matched.get_string("fraction").length()
			while digits.length() > 1 && digits.begins_with("0"):
				digits = digits.substr(1)
			cache[token] = _rounded_float(DecimalValue.new(digits, exponent), token.begins_with("-"))
		bytes.append_array(JSON.stringify(marker + str(values.size())).to_utf8_buffer())
		values.append(cache[token])
		cursor = matched.get_end()
		matched = _decimal_numbers.search(text, cursor)
	bytes.append_array(text.substr(cursor).to_utf8_buffer())
	text = ""
	var replaced: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	bytes.clear()
	return _restore(replaced, marker, values)


static func _decimal_exponent(text: String) -> int:
	var negative := text.begins_with("-")
	var digits := text.trim_prefix("-").trim_prefix("+")
	while digits.length() > 1 && digits.begins_with("0"):
		digits = digits.substr(1)
	# A larger exponent cannot be offset by the length of a Godot string.
	var value := digits.to_int() if digits.length() <= 10 else 10000000000
	return -value if negative else value


static func _contains_marker(value: Variant, marker: String) -> bool:
	if value is String:
		return value.begins_with(marker)
	if value is Array:
		for child: Variant in value:
			if _contains_marker(child, marker):
				return true
	elif value is Dictionary:
		for key: String in value:
			if key.begins_with(marker) || _contains_marker(value[key], marker):
				return true
	return false


static func _restore(value: Variant, marker: String, values: Array[float]) -> Variant:
	if value is String && value.begins_with(marker):
		return values[value.substr(marker.length()).to_int()]
	if value is Array:
		for index: int in value.size():
			value[index] = _restore(value[index], marker, values)
	elif value is Dictionary:
		for key: String in value:
			value[key] = _restore(value[key], marker, values)
	return value


static func _compare(left: DecimalValue, right: DecimalValue) -> int:
	var left_size := left.digits.length() + left.exponent
	var right_size := right.digits.length() + right.exponent
	if left_size != right_size:
		return -1 if left_size < right_size else 1
	var length := maxi(left.digits.length(), right.digits.length())
	var a := left.digits.rpad(length, "0")
	var b := right.digits.rpad(length, "0")
	return 0 if a == b else (-1 if a < b else 1)


static func _midpoint(bits: int) -> DecimalValue:
	var next := bits + 1
	var left_exponent := (bits >> 52) & 0x7ff
	var right_exponent := (next >> 52) & 0x7ff
	var left_mantissa := (bits & FRACTION_MASK) + ((1 << 52) if left_exponent else 0)
	var right_mantissa := (next & FRACTION_MASK) + ((1 << 52) if right_exponent else 0)
	left_exponent = left_exponent - 1075 if left_exponent else -1074
	right_exponent = right_exponent - 1075 if right_exponent else -1074
	var exponent := mini(left_exponent, right_exponent)
	var mantissa := (left_mantissa << (left_exponent - exponent)) + (right_mantissa << (right_exponent - exponent))
	exponent -= 1
	var limbs: Array[int] = []
	while mantissa:
		limbs.append(mantissa % LIMB_BASE)
		@warning_ignore("integer_division")
		mantissa /= LIMB_BASE
	var factor := 2 if exponent >= 0 else 5
	for _power: int in absi(exponent):
		var carry := 0
		for index: int in limbs.size():
			var product := limbs[index] * factor + carry
			limbs[index] = product % LIMB_BASE
			@warning_ignore("integer_division")
			carry = product / LIMB_BASE
		if carry:
			limbs.append(carry)
	var digits := str(limbs.back())
	for index: int in range(limbs.size() - 2, -1, -1):
		digits += str(limbs[index]).lpad(7, "0")
	return DecimalValue.new(digits, mini(exponent, 0))


static func _rounded_float(decimal: DecimalValue, negative: bool) -> float:
	var storage := PackedByteArray()
	storage.resize(8)
	var magnitude := decimal.digits.length() + decimal.exponent
	if decimal.digits == "0" || magnitude < -330:
		if negative:
			storage[7] = 128
		return storage.decode_double(0)
	if magnitude > 310:
		return -INF if negative else INF
	var normalized := decimal.digits.left(1) + "." + decimal.digits.substr(1) + "e" + str(magnitude - 1)
	storage.encode_double(0, normalized.to_float())
	var bits := storage.decode_u64(0)
	# Native conversion is a starting estimate. Exact decimal midpoints decide rounding and ties.
	for _attempt: int in 8:
		if bits > 0:
			var lower := _compare(decimal, _midpoint(bits - 1))
			if lower < 0 || (lower == 0 && (bits & 1)):
				bits -= 1
				continue
		if bits < INFINITY_BITS:
			var upper := _compare(decimal, _midpoint(bits))
			if upper > 0 || (upper == 0 && (bits & 1)):
				bits += 1
				continue
		storage.encode_u64(0, bits)
		var result := storage.decode_double(0)
		return -result if negative else result
	var low := 0
	var high := INFINITY_BITS
	while low < high:
		@warning_ignore("integer_division")
		var middle := low + (high - low) / 2
		var comparison := _compare(decimal, _midpoint(middle))
		if comparison < 0 || (comparison == 0 && !(middle & 1)):
			high = middle
		else:
			low = middle + 1
	storage.encode_u64(0, low)
	var result := storage.decode_double(0)
	return -result if negative else result


class DecimalValue:
	var digits: String
	var exponent: int

	func _init(value: String, scale: int) -> void:
		digits = value
		exponent = scale
		while digits.length() > 1 && digits.ends_with("0"):
			digits = digits.left(-1)
			exponent += 1
