const { resolveProjectFile } = require("../factory/workspace-router");

class VisualExecutor {
  constructor({ tools }) {
    this.tools = tools;
    this.taskAbort = new Map();
  }

  supports(toolName) {
    return toolName === "file-create" || toolName === "file-write";
  }

  abortTask(taskId) {
    if (!taskId) return;
    this.taskAbort.set(taskId, true);
  }

  clearTask(taskId) {
    if (!taskId) return;
    this.taskAbort.delete(taskId);
  }

  isAborted(taskId) {
    return Boolean(taskId && this.taskAbort.get(taskId));
  }

  randomDelay() {
    return 5 + Math.floor(Math.random() * 21);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  bufferKey(projectName, filePath) {
    return `${projectName}:${filePath}`;
  }

  preflightFileTarget(projectName, filePath) {
    resolveProjectFile(projectName, filePath);
  }

  async renderTyping({ taskId, projectName, filePath, content }) {
    let rendered = "";
    const maxBytes = 200 * 1024;
    const byteLength = Buffer.byteLength(String(content), "utf8");

    if (byteLength > maxBytes) {
      return { skipped: true };
    }

    const key = this.bufferKey(projectName, filePath);

    for (const char of String(content)) {
      if (this.isAborted(taskId)) {
        throw new Error("Visual typing aborted");
      }

      rendered += char;
      this.emitEditorBuffer({
        key,
        projectName,
        path: filePath,
        content: rendered,
      });

      await this.sleep(this.randomDelay());
      if (char === "\n") {
        await this.sleep(80);
      }
    }

    await this.sleep(150);
    return { skipped: false };
  }

  emitEditorBuffer(payload) {
    const studioEvents = require("../studio/studio-events");
    studioEvents.emit("editor.buffer", payload);
  }

  async executeStep({ step, handler, handlerInput }) {
    const toolName = step.tool;
    const projectName = step.input.projectName || handlerInput.activeProject;
    const filePath = step.input.path;
    const content = step.input.content || "";

    try {
      if (!projectName) {
        return handler(handlerInput);
      }

      this.preflightFileTarget(projectName, filePath);

      if (toolName === "file-create") {
        const createInput =
          content.length > 0
            ? {
                ...handlerInput,
                input: { ...handlerInput.input, content: "" },
              }
            : handlerInput;

        const created = await handler(createInput);

        if (!content.length) {
          this.clearTask(handlerInput.taskId);
          return created;
        }

        const typed = await this.renderTyping({
          taskId: handlerInput.taskId,
          projectName,
          filePath,
          content,
        });

        if (typed.skipped) {
          this.emitEditorBuffer({
            key: this.bufferKey(projectName, filePath),
            projectName,
            path: filePath,
            content,
          });
        }

        const persisted = await this.tools["file-write"]({
          ...handlerInput,
          input: { ...handlerInput.input, content },
        });

        this.clearTask(handlerInput.taskId);
        return {
          output: persisted.output || created.output,
          contextPatch: persisted.contextPatch || created.contextPatch || null,
          data: persisted.data || created.data || null,
        };
      }

      if (toolName === "file-write") {
        const typed = await this.renderTyping({
          taskId: handlerInput.taskId,
          projectName,
          filePath,
          content,
        });

        if (typed.skipped) {
          this.emitEditorBuffer({
            key: this.bufferKey(projectName, filePath),
            projectName,
            path: filePath,
            content,
          });
        }

        const persisted = await handler(handlerInput);
        this.clearTask(handlerInput.taskId);
        return persisted;
      }

      const result = await handler(handlerInput);
      this.clearTask(handlerInput.taskId);
      return result;
    } catch (error) {
      this.abortTask(handlerInput.taskId);
      throw error;
    }
  }
}

module.exports = VisualExecutor;
