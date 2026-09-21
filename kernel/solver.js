// HiGHS can retain a valid integer solution even when its search reaches a limit.
export function runSolver(highs, text, options = {}, seed) {
  const model = highs.createModel({format: 'lp', data: text});
  try {
    model.options.set({output_flag: false, mip_rel_gap: 0, mip_feasibility_tolerance: 1e-9,
      primal_feasibility_tolerance: 1e-9, ...options});
    if (seed) {
      const indices = [], values = [];
      for (const [name, value] of Object.entries(seed)) {
        if (!Number.isFinite(value)) throw new Error(`Invalid initial solver value for ${name}.`);
        indices.push(model.getColByName(name));
        values.push(value);
      }
      if (indices.length) model.setSolution({indices, values});
    }
    model.run();
    const status = model.getModelStatus();
    const states = highs.constants.modelStatus;
    const feasible = model.info.get('primal_solution_status') === highs.constants.solutionStatus.feasible;
    const result = {status: Object.keys(states).find(name => states[name] === status) ?? 'unknown',
      feasible, optimal: status === states.optimal, columns: null, objective: null,
      lower_bound: null, relative_gap: null};
    if (feasible) {
      const solution = model.getSolution();
      if (![...solution.colValue, ...solution.rowValue].every(Number.isFinite)) throw new Error('The solver returned non-finite values.');
      result.columns = Object.create(null);
      for (let index = 0; index < solution.colValue.length; index++) result.columns[model.getColName(index)] = solution.colValue[index];
      result.objective = model.getObjectiveValue();
      if (!Number.isFinite(result.objective)) throw new Error('The solver returned a non-finite objective.');
      const bound = model.info.get('mip_dual_bound');
      const gap = model.info.get('mip_gap');
      if (Number.isFinite(bound)) result.lower_bound = bound;
      if (Number.isFinite(gap)) result.relative_gap = gap;
      if (result.optimal) { result.lower_bound = result.objective; result.relative_gap = 0; }
    }
    return result;
  } finally {
    model.dispose();
  }
}
