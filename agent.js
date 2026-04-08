const engine = require("./src/engine");

async function run(task, context = {}) {
  const result = await engine.submit(task, { source: "direct", ...context });
  return [
    `Project: ${result.activeProject || "none"}`,
    `Plan Steps: ${result.plan?.steps?.length || 0}`,
    "",
    result.output || "Task completed",
  ].join("\n");
}

module.exports = { run };
