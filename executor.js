const ExecutionAdapter = require("./src/executor/execution-adapter");

async function run(planInput) {
  const plan =
    typeof planInput === "string" ? JSON.parse(planInput) : planInput || { steps: [] };
  const adapter = new ExecutionAdapter();
  const result = await adapter.executePlan(
    plan,
    { taskId: "legacy-run", activeProject: null },
    "headless"
  );
  return result.output || "";
}

module.exports = { run };
