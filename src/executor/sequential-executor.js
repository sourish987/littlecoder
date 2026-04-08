const config = require("../infra/config");
const studioEvents = require("../studio/studio-events");

class SequentialExecutor {
  constructor({ tools, visualExecutor }) {
    this.tools = tools;
    this.visualExecutor = visualExecutor;
  }

  async executePlan(plan, context) {
    const executionContext = {
      ...context,
      activeProject: context.activeProject || null,
      editorBuffers: context.editorBuffers || {},
      executionMode: context.executionMode || config.executionMode || "headless",
    };

    const results = [];
    try {
      for (const step of plan.steps || []) {
        const result = await this.executeStep(step, executionContext);
        if (result.contextPatch) {
          Object.assign(executionContext, result.contextPatch);
        }
        results.push(result);
      }
    } catch (error) {
      if (executionContext.executionMode === "visual" && this.visualExecutor) {
        this.visualExecutor.abortTask(executionContext.taskId);
      }
      throw error;
    }

    return {
      results,
      context: executionContext,
      output: results
        .map((entry) => entry.output)
        .filter(Boolean)
        .join("\n"),
    };
  }

  async executeStep(step, context) {
    if (!step || !step.tool) {
      throw new Error("Step is missing tool");
    }

    const handler = this.tools[step.tool];
    if (!handler) {
      throw new Error(`Unknown tool: ${step.tool}`);
    }

    const stepId = step.id || `${step.tool}-${Date.now()}`;
    const stepProjectName =
      step.tool === "project-create"
        ? step.input?.name || null
        : step.input?.projectName || context.activeProject || null;
    studioEvents.emit("step.start", {
      taskId: context.taskId,
      stepId,
      tool: step.tool,
      input: step.input || {},
      projectName: stepProjectName,
    });

    const handlerInput = {
      taskId: context.taskId,
      stepId,
      timeoutMs: step.timeoutMs || config.worker.stepTimeoutMs,
      activeProject: context.activeProject,
      input: step.input || {},
      context,
    };

    let result;
    if (
      context.executionMode === "visual" &&
      this.visualExecutor &&
      this.visualExecutor.supports(step.tool)
    ) {
      result = await this.visualExecutor.executeStep({
        step,
        handler,
        handlerInput,
      });
    } else {
      result = await handler(handlerInput);
    }

    studioEvents.emit("step.done", {
      taskId: context.taskId,
      stepId,
      tool: step.tool,
      input: step.input || {},
      projectName: stepProjectName,
    });

    return {
      stepId,
      tool: step.tool,
      output: result.output || "",
      contextPatch: result.contextPatch || null,
      data: result.data || null,
    };
  }
}

module.exports = SequentialExecutor;
