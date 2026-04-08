const SequentialExecutor = require("./sequential-executor");
const VisualExecutor = require("./visual-executor");
const projectCreate = require("../tools/project-create");
const fileCreate = require("../tools/file-create");
const fileWrite = require("../tools/file-write");
const terminalRun = require("../tools/terminal-run");

const headlessTools = {
  "project-create": projectCreate,
  "file-create": fileCreate,
  "file-write": fileWrite,
  "terminal-run": terminalRun,
};

class ExecutionAdapter {
  constructor() {
    this.visual = new VisualExecutor({ tools: headlessTools });
    this.executor = new SequentialExecutor({
      tools: headlessTools,
      visualExecutor: this.visual,
    });
  }

  async executePlan(plan, context, mode) {
    return this.executor.executePlan(plan, {
      ...context,
      executionMode: mode || "headless",
    });
  }

  async executeStep(step, context, mode) {
    const plan = { steps: [step] };
    const result = await this.executePlan(plan, context, mode);
    return result.results[0];
  }
}

module.exports = ExecutionAdapter;
