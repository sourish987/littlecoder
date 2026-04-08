function translatePlan(plan) {
  return {
    actions: (plan.steps || []).map((step) => ({
      type: "TOOL_STEP",
      tool: step.tool,
      input: step.input || {},
    })),
  };
}

module.exports = { translatePlan };
