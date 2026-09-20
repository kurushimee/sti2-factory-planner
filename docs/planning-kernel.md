# Planning kernel

Issue #5 owns this implementation. The current kernel is an isolated calculation component. It is not yet integrated into the Godot application or the complete StaTech dataset.

`kernel/planner.js` builds a mixed-integer model for operation rates, whole-machine allocations, explicit external supplies, and resource balances. Generation is represented as a process producing `energy:eu`; production and generation support processes consume that same resource. Fixed infrastructure demand is included in the energy balance. Positive allocation costs prevent unused machines from being added for free.

The default objective weights are 1,000 per external resource unit per second, 1 per machine build-cost unit, and 0.000001 per operating EU per second. These are configurable optimization weights, not claims about comparable real-world resource value. Recipe input costs include the complete connected support graph. Build-cost values currently come from configuration records; deriving actual machine and upgrade material costs is pending.

By default, only one recipe with a given primary output can be active. Byproduct supplies remain usable. When a relaxation mixes primary routes, the search branches over every available primary route and uses exact mixed-integer subproblems as lower bounds. It does not invent a large machine-count bound. The search reports an optimum only after exhausting or pruning all branches. Time limits return an explicit incomplete-search result and any available incumbent.

The returned plan describes a steady-state balance. It does not yet establish bootstrap stock, a complete warm-up buffer plan, progression, recipe conditions, catalysts, or safe stochastic stock levels. A circulating container can balance at zero net consumption while still needing an initial fill; callers must not present the current result as a verified startup plan. These missing adapters and calculations remain required under #3 and #5.

## Capacity rules

`kernel/capacity.js` implements the independently captured MI crafter power samples and the Tesseract percentage-batching transform. Capacities use whole ticks. Upgrade compatibility and count limits are checked against supplied machine records. Batching transforms use Java float rounding before the integer cast, matching the source's arithmetic. Efficiency increases once per completed operation or batch. The output buffer calculation includes delivery before the first completed recipe, including machines without a warm-up phase.

This evaluator assumes continuous ingredients, space for outputs, and no overdrive or lubricant. It supports only the explicitly named `mi_crafter` and `mi_batch` mechanics. Applying it to generators, alternate efficiency hooks, steam catalysts, or a different addon without an adapter is an error. The computed per-machine output deficit is not yet a whole-factory buffer schedule.

## Runtime and numeric behavior

The same HiGHS 1.15.3 WebAssembly runtime executes the model in Node and in a browser Worker. `kernel/desktop.js` accepts input and output file paths and publishes a complete JSON result through a temporary file and rename. The desktop package must bundle Node; no user installation should be required. `kernel/worker.js` uses local web assets and phase messages. Terminating its Worker cancels computation. Neither adapter is wired into Godot yet.

Inputs outside JavaScript's safe integer range are rejected where integer arithmetic is required. Resource balances and whole-machine capacities are checked after solving. Results report each resource balance's numerical tolerance. Large coefficients and near-degenerate models still need broader endgame validation; the trillion-unit regression case is a focused check, not that validation.

## Checks

Run `npm ci --ignore-scripts` and `npm test`. Keep `node_modules/.gdignore` present before importing the Godot project. The tests cover captured MI arithmetic, integer tick capacity, batching, warm-up delivery, sharing, independent intermediate goals, byproducts, returned containers, a nonproductive cycle, fuel-chain power feedback, replication, route pins, single primary routes, installed limits, unsupported processes, time limits, and large machine counts.

For the isolated browser check, install Chromium with `npx playwright install chromium`, then run `node tools/verify_kernel_browser.mjs`. On the development workstation set `PLAYWRIGHT_BROWSERS_PATH=F:/sti2-work/tools/playwright`. The check serves only the kernel test assets on loopback, executes a Worker inside an iframe with a different origin, and requires the result to match Node exactly without cross-origin isolation. It does not test a Godot export, world ZIP import, or browser plan persistence.
