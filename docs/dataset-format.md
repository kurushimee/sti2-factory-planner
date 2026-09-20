# Dataset and plan format

Datasets use UTF-8 JSON with `format: 1`. They contain resource identities, recipe flows, and machine configurations or supported machine rules. Import a dataset through the application's Import button. No application rebuild is needed. Importing a dataset starts an empty factory; undo restores the previous plan and dataset.

The small [example dataset](../data/example.json) is a complete fictional factory with extraction, intermediate recipes, and fuel-powered generation. Copy it when adding a pack with fixed machine capacities. Run `node tools/validate_dataset.mjs path/to/dataset.json` to check the format and resource references. The calculation worker runs the same validation before selecting connected recipes. These checks establish structural consistency, not whether a recipe matches a game.

## Identities and units

Give the dataset a stable `identity`, such as `pack-name:version`, and a readable `name`. Use `description` for a short explanation of its scope. Set `complete` to false while required adapters or production chains are missing. Preserve extraction inputs, mod versions, and source references in `source` and linked provenance files.

`resources` is a list of objects with a unique nonempty `id`. `name` and `unit` provide display information. StaTech uses `item:namespace:path`, `fluid:namespace:path`, and `energy:eu`. Component-bearing item variants have distinct IDs and retain their components in the resource record. Resource IDs are opaque strings; do not infer fluid conversions from their names in a custom dataset.

All recipe amounts are per operation. Item amounts count items, StaTech fluid amounts use millibuckets, and electricity uses EU. Rates are per second. A game tick is 1/20 second. `eu_per_tick` and idle power use EU/t; `eu_per_operation` uses total EU. Never put a bucket count in a millibucket field. Expected probabilistic amounts may be fractional; mark the recipe with `expected_yields: true` and retain the original probabilities in its source evidence.

## Recipes and flows

Every recipe has a unique `id`, a `primary` resource, `inputs`, `outputs`, and a `configurations` list. The primary resource must appear among its outputs. `name`, `group`, `source_id`, `type`, and `origin` help players inspect and organize the recipe.

An ordinary flow is `{"resource":"ore","amount":2}`. An input may instead use `{"choices":["oak","birch"],"amount":1}`. Output flows always name one resource. Alternatives share a resource balance and may be pinned by the player. A flow's optional `returns` object maps each chosen input ID to the materials returned per unit of that input. For example, a filled bucket input may return one empty bucket. Do not also add that same return as an unconditional output.

`catalysts` uses input-flow records for retained materials. These become startup stock and do not disappear on each operation. A catalyst with several choices requires an explicit selection. Consumable tools need a verified consumption model; do not label them catalysts merely because they survive one craft.

`replication: true` excludes the entire route when replication is disabled. `requires_obtained` lists items the player must already have. Use this for replication templates and creative infrastructure that cannot be used to create itself. These flags do not manufacture the required items.

When behavior is unsupported, retain the recipe with an `unsupported` explanation. The planner excludes it and reports the reason. Entries that cannot yet be converted to a recipe belong in `unsupported_entries`, with their source identity and reason. Neither form grants an external resource supply.

## Fixed configurations

A configuration needs an `id`, a `machine` ID, and positive `operations_per_second`. Give configuration IDs globally distinct names because plan pins and installed limits refer to them. Optional fields are:

| Field | Meaning |
| --- | --- |
| `eu_per_operation` | Electricity consumed by one completed operation. |
| `idle_eu_per_tick` | Electricity consumed by every installed machine, even while idle. |
| `inputs` | Additional operating inputs, such as steam. |
| `build_cost` | Positive machine allocation weight; defaults to 1. This is not automatically the machine's material cost. |
| `build_requirements` | Concrete items needed for one configuration, including upgrades and contained machines. |
| `startup_inputs` | Retained initial inputs per installed machine. |
| `assumptions` | Plain-language limits on the capacity estimate. |

Represent generation as a recipe whose output includes `energy:eu`. Fuel and coolant are ordinary inputs, so their production and power demands join the same factory. Returned coolant is a returned material or output; only actual losses belong in the sustained replacement demand. Initial loop fill belongs in startup stock. Fixed capacities without a verified completion schedule receive an explicit missing-startup warning.

## Machine rules

A process-based recipe leaves `configurations` empty and supplies `process`. Industrial processes specify `type`, whole `duration_ticks`, and whole `eu_per_tick`. Ordinary crafting uses `type: "planner:crafting"`; its timing comes from the assembler. `machines` contains unique machine IDs, `status` (`supported`, `unsupported`, or `structural`), and a `mechanic` for supported entries. Structural parts are not independent production machines.

The implemented capacity families are `mi_crafter`, `mi_batch`, `mi_array`, `ae_molecular_assembler`, and `fixed_cycle`. Fields are defined by the corresponding calculations in [capacity.js](../kernel/capacity.js) and [configuration.js](../kernel/configuration.js). MI rules use `base_eu`, `max_eu`, `upgrades`, and `upgrade_limit`. Batch rules add `batch_limit` and `energy_multiplier`. Shape-dependent `batch_tiers`, `recipe_eu_limits`, and `fluid_output_limits` constrain the selected structure. Arrays add `shape_capacities`, `eligible_machines`, and `contained_recipe_types`; they retain their own power rules rather than inheriting the contained machine's capacity.

`upgrades` is a list of unique IDs with integer `extra_max_eu` and an optional allocation `build_cost`. A concrete setup supplies the complete upgrade record plus `upgrade_count`. Array setups add `contained_machine`, `contained_count`, `batch`, and zero-based `shape`. Some steam multiblocks support `steel_hatches`; their rules define the resulting tier. The current build bill includes controllers, upgrades, contained machines, and explicit extra build inputs. It does not yet derive every structural block from a multiblock shape.

Some extraction adapters, such as fuel generators and boilers, emit fixed configurations directly. Their source rule names are metadata and do not imply that the generic process compiler can execute that mechanic. Unknown process conditions remain explicit exclusions. Currently supported condition types cover verified dimension, biome, adjacent block, EI runtime flag, and generation-output buffer requirements. Environmental assumptions appear with the configuration; the planner does not simulate world placement.

## Portable plans

A plan uses `format: "factory-plan"` and `version: 1`. It embeds `dataset`, a matching `dataset_identity`, `request`, `positions`, and `groups`. Embedding the dataset keeps the plan portable. Optional `imported_world` retains origin facts, evidence, corrections, and unresolved assignments; it does not contain the original world archive. `preferences` stores sound and reduced-motion choices.

`request.goals` contains independent output demands. Rate goals have `resource`, `rate`, and optional `recipe`. Capacity goals also set `kind: "capacity"`, `recipe`, `configuration`, and whole `machines`; output capacity determines the rate. Finite goals use `kind: "quantity"`, `quantity`, and a sustained `rate`. Store large quantities as decimal strings, such as `"1000000000000000000000000000001"`; exponent notation is also accepted. The format accepts up to 1,000 decimal digits and an adjusted decimal exponent from -1,000 through 1,000. Their duration begins after startup. Several coproduct goals share operations; adding an independent intermediate goal adds its demand to downstream consumption.

| Request field | Meaning |
| --- | --- |
| `replication` | Whether replication-dependent routes are allowed. |
| `available_machines`, `available_upgrades` | Allowed IDs. Machine omission uses dataset defaults; upgrade omission allows no automatic upgrades. |
| `disabled_machines`, `disabled_upgrades`, `disabled_recipes` | Explicit exclusions. The settings editor folds machine and upgrade exclusions into its allowed lists. |
| `obtained_resources` | Previously obtained templates or prerequisite items. |
| `external` | Explicit supplies: resource ID, optional rate `limit`, objective `cost`, and `firm_capacity` in EU/s for firm external power. |
| `routes` | Primary resource ID to pinned recipe ID. |
| `configurations` | Recipe ID to a configuration ID or list of IDs. |
| `machine_setups` | Recipe ID to concrete `{machine, setup, configuration}` records for compiling saved loadouts. |
| `ingredients`, `catalysts` | `recipe_id#slot_index` to selected resource ID. Slots are zero-based. |
| `installed`, `limits` | Configuration ID to exact installed count or maximum count. |
| `dispatch` | Configuration ID to operation-rate `minimum` and/or `maximum`, per second. |
| `reserve_fraction` | Installed generation headroom; 0.25 means 25%. It does not burn standby fuel. |
| `overhead_eu_per_tick` | Fixed infrastructure consumption. |
| `weights` | Nonnegative `external`, `machines`, and `energy` objective weights. The machine weight must be positive. |
| `single_primary_route` | Defaults to true; byproducts remain usable. |
| `available_dimensions`, `available_biomes` | Optional environmental restrictions. |

`positions` maps recipe/configuration node keys to `[x,y]`. `groups` maps group IDs to `{title, rect:[x,y,width,height]}`. Group membership follows node centers and boundary size, with a stable ID tie-break for overlaps. Resizing a group changes membership without moving nodes.

Numeric amounts and rates must be finite and no larger than JavaScript's safe integer bound, 9,007,199,254,740,991. Integer engine rules use integer arithmetic where required; optimization uses floating-point coefficients with checked residuals. Finite quantities stored as text use exact integer ratios for duration and upward-rounded completion ticks. Results expose `steady_production_seconds_exact` as numerator and denominator strings and `completion_ticks_ceil` as a string; `time_display` labels rounded durations. This does not make the optimization coefficients arbitrary precision. Full large-endgame verification remains open; a passing format check does not establish it.

### Saved multiblock geometry

A machine may supply `shapes`, each with an integer `index` and `cells`. Each cell has a relative integer `position` triple, `allowed_hatches` type IDs, and a `member_rule` index into the dataset’s `shape_member_rules`. A verified state-only member rule has `state_only_verified: true` and `matching_states`, using Minecraft palette objects with `Name` and string-valued `Properties`. Rules requiring block entity behavior remain unsupported until an adapter is available. These optional records support save reconstruction; they do not change processing capacity or establish observed production.

Configurations may define `operating_points` for a machine whose running inputs depend on its load. Each point has `operations_per_second` and `inputs`; these input amounts are rates per second for one machine at that point. Points must increase from zero to the configuration's full capacity. The solver assigns fractions of operating time to the points while retaining a whole installed-machine count. Recipe inputs still apply per operation. This represents repeatable dispatch with sufficient buffers, not fractional construction. Include hot idle consumption in the zero-output point and state the dispatch assumptions. The large-boiler adapter uses the lower fuel envelope of captured whole-tick outputs, including heat loss and rounding.
