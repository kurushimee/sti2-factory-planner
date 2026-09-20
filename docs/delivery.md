# Delivery requirements

Issue #2 tracks the complete application. Milestones do not end the task or require another user prompt. Main receives only completed, verified branches through issue-linked squash PRs.

## Dataset and calculations

Ship a reproducibly extracted StaTech Industry 2.0.1 dataset with exact mod versions, input hashes, licenses, effective recipes, resolved tags, generated content, configuration, and source references. Include MI, Extended Industrialization, Industrialization Overdrive, Yet Another Industrialization, custom content, ordinary crafting, extraction, and other participating processes. Prove the data matches a loaded pack. Supply versioned JSON documentation, validation, and a small example. Importing another pack must not require rebuilding the application.

Plan the connected factory with shared demand, useful byproducts, returned materials, recycling, alternative ingredients, catalysts, consumable tools, expected probabilistic yields, and conditions. Prevent free-resource cycles. Prefer one primary route per resource while respecting pins. Compare complete material costs; prefer available ordinary crafting automation over assembly for equal costs. Explain objective priorities and infeasibility. Creative goals cannot supply themselves.

Support progression presets and individual availability overrides, replication and replicatorless modes, singleblocks, batching multiblocks, and both processing arrays with their actual contents. Allocate whole machines to individual recipes with exact compatible upgrades, voltage, slots, tick limits, batching, discounts, and overclock rules. Preserve internal precision for large endgame goals. Goals include output rates, machine capacity, and finite quantities with time estimates.

Distinguish steady-state continuous-supply capacity, warm-up, startup, and stock replenishment. Calculate a buffer for every resource affected by warm-up without overdrive modules. Quantity targets never imply rates without a refill assumption. Headroom cannot hide sustained deficits.

Generation shares the production graph. Support mixed generators, counts or limits, reserve, fuel and support machinery, feedback consumption, infrastructure overhead, and closed fluid loops. Show gross generation, support consumption, net power, and margin; separate sustained, idle, peak, startup, initial fill, and replacement losses.

## Workspace and persistence

Use one editable 2D graph for all production and generation. Adding a recipe and goal creates and sizes its complete support. Reuse shared intermediates without losing independent demand, and preserve needed prerequisites when goals are removed. Nodes show machines, counts, upgrades, throughput, and power; connections show directed resources and rates. The inspector explains arithmetic, alternatives, conditions, and sources.

Arrange initial groups by production category. Users can edit and move groups; group movement moves members, while boundary resizing changes membership without moving nodes. Define predictable overlap behavior. Recalculation preserves manual layout. Provide explicit auto-layout, pan, zoom, selection, search, focus, undo, and redo.

Save dataset identity, goals, settings, pins, positions, and groups. Support portable import/export and browser persistence. Keep long work responsive with progress and useful cancellation. Failed imports and calculations must preserve the current plan. Render and inspect every visual change.

## World import

Process a world ZIP locally inside desktop and web builds. Read actual dimension, region, NBT, mod, AE2, requester, cable-mounted pattern provider, machine, multiblock, upgrade, and array serialization. Preserve world coordinates and evidence. Do not count multiblock parts or every available pattern as installed production.

Reconstruct lines and infer retained end-goal outputs. Preserve imported end-goal recipes, machine counts, and upgrades as initial capacity targets; recalculate their upstream support without preserving bottlenecks. Expose editable goals and focused corrections. Distinguish saved facts from deductions and configured capacity from observed rates. Inventory and requester thresholds remain quantities. Report ambiguous, unsupported, malformed, and mismatched entries instead of dropping them. Handle large archives and ordinary wrapper folders; never modify source saves.

## Release gates

Verify arithmetic against independent pack examples and known small cases, covering early and late progression, sharing, cycles, upgrades, batching, generation, and both replication modes. Verify importer formats with real controlled saves; synthetic fixtures are supplemental. Exercise graph interactions, group semantics, duplicate and intermediate goals, undo, persistence, and failure recovery in the application. Measure representative large plans and imports.

Test exported Windows and web builds, including ZIP import and persistence in hosted and embedded browser conditions. Deliver build archives, export presets, extraction tooling, tests, CI, format and import documentation, and concise running, building, and itch.io publishing instructions. Report concrete unresolved blockers and keep incomplete work off main.
