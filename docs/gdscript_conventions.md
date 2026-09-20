# GDScript conventions

Use these conventions when editing project GDScript. Addons are exempt only from the resource-loading restriction below; keep vendored code under its own ownership rules.

## Types and names

- Use `snake_case` for files, variables, methods, and signals; PascalCase for classes; and UPPER_SNAKE_CASE for constants. Reserve `NG_` for reusable studio classes rather than application-specific types.
- Statically type variables, parameters, return values, arrays, and dictionaries. Use `:=` when the expression establishes one concrete type, such as `.new()`, `Vector2(...)`, or `String(...)`.
- Type dictionaries as well as arrays, for example `Dictionary[int, String]`. Godot does not support nested typed collections.
- Default exported `Packed*Array` values to their own constructor, such as `PackedStringArray()`, or leave them uninitialised. An untyped `[]` default can make editor resaves discard authored array values even when a running build reads them.
- Use `!` for boolean negation; `is not` remains valid for type tests.
- Prefix only script-private variables and methods with `_`. Enums, constants, signals, inner classes, and public/static members have no underscore prefix.
- Use `if value` and `if !value` for nullable objects. Use `is_instance_valid()` when a reference may point to a freed object.

## Declaration order

Follow `gdlintrc`: annotations (`@tool`, `@icon`, `@static_unload`), `class_name`, `extends`, class documentation, signals, enums, constants, static variables, `@onready` variables, `@export` variables, other variables, `_static_init()`, other static methods, built-in virtual methods, overridden custom methods, other methods, then inner classes.

Order built-in virtual methods as `_init()`, `_enter_tree()`, `_ready()`, `_process()`, `_physics_process()`, then other virtual methods. Within variable and method groups, public members precede private members.

## Resources and structured data

- Project game code must not call runtime `load()` or `preload()`; addons are exempt. Supply resources and scenes through exported references. Give externally referenced scripts a unique `class_name` instead of loading scripts by path.
- Represent structured records with classes rather than JSON-shaped `Array[Dictionary]` values with repeated field names. When only a name varies, prefer a typed dictionary keyed by that name.
- Access fixed plain-string dictionary keys as `dict.key_name`; use brackets for dynamic keys.

## Scenes and presentation

- Author nodes and properties in `.tscn` files. Before creating nodes in code, check whether they can exist statically; conditional nodes normally stay in the scene and are shown or hidden.
- Use `%` unique names for child access instead of `$` or layout paths through `get_node()`.
- Use `visible = condition` for conditional visibility, and `show()` or `hide()` for unconditional changes.
- Put localization keys directly in text fields and resource properties. Call `tr()` only when composing substitutions, markup, or other text.
