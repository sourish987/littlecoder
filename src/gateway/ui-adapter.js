const crypto = require("crypto");
const studioEvents = require("../studio/studio-events");

function formatTaskResult(result) {
  if (result.resolvedMode === "chat") {
    return String(result.output || "LittleCoder is ready.").trim();
  }

  return [
    `Project: ${result.activeProject || "none"}`,
    `Attempts: ${result.attempts}`,
    "",
    result.output || "Task completed",
  ]
    .join("\n")
    .trim();
}

function createUiAdapter({ engine }) {
  return {
    name: "studio",
    isCore: true,
    async start({ updateStatus }) {
      updateStatus({
        enabled: true,
        status: "ready",
        label: "Studio chat ready",
      });
    },
    registerRoutes(app) {
      app.post("/api/chat", async (req, res) => {
        const text = String(req.body?.message || "").trim();
        const mode = String(req.body?.mode || "auto").trim().toLowerCase();
        if (!text) {
          res.status(400).json({ ok: false, error: "Message is required" });
          return;
        }

        const userMessageId = crypto.randomUUID();
        studioEvents.emit("chat.message", {
          id: userMessageId,
          role: "user",
          channel: "studio",
          text,
          status: "sent",
        });

        try {
          const result = await engine.submit(text, {
            source: "studio-ui",
            mode,
          });

          const reply = formatTaskResult(result);
          studioEvents.emit("chat.message", {
            id: crypto.randomUUID(),
            role: "worker",
            channel: "studio",
            text: reply,
            status: "done",
          });

          res.json({
            ok: true,
            reply,
            activeProject: result.activeProject || null,
            taskId: result.taskId,
            requestedMode: result.requestedMode || mode,
            resolvedMode: result.resolvedMode || mode,
          });
        } catch (error) {
          const message = `Execution failed: ${error.message}`;
          studioEvents.emit("chat.message", {
            id: crypto.randomUUID(),
            role: "worker",
            channel: "studio",
            text: message,
            status: "error",
          });

          res.status(500).json({
            ok: false,
            error: message,
          });
        }
      });
    },
    async stop() {},
  };
}

module.exports = { createUiAdapter };
