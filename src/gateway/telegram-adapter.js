const TelegramBot = require("node-telegram-bot-api");
const studioEvents = require("../studio/studio-events");
const config = require("../infra/config");

const MAX_MESSAGE_LENGTH = 3800;
const STILL_WORKING_INTERVAL_MS = 10000;

function splitMessage(text) {
  const value = String(text || "").trim();
  if (!value) return [];

  if (value.length <= MAX_MESSAGE_LENGTH) {
    return [value];
  }

  const chunks = [];
  let remaining = value;
  while (remaining.length > MAX_MESSAGE_LENGTH) {
    const boundary = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    const sliceAt = boundary > 0 ? boundary : MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, sliceAt).trim());
    remaining = remaining.slice(sliceAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function safeReply(bot, chatId, text) {
  for (const chunk of splitMessage(text)) {
    try {
      await bot.sendMessage(chatId, chunk);
    } catch {}
  }
}

function formatCommand(input = {}) {
  const command = String(input.command || "").trim();
  const args = Array.isArray(input.args) ? input.args.map(String) : [];
  return [command, ...args].filter(Boolean).join(" ").trim();
}

function normalizeFileList(files) {
  const values = Array.from(files || []).filter(Boolean);
  return values.length ? values.join("\n") : "None";
}

function normalizeCommandList(commands) {
  const values = Array.from(commands || []).filter(Boolean);
  return values.length ? values.join("\n") : "None";
}

function formatSummary(session) {
  return [
    "Task completed.",
    "",
    "Project:",
    session.projectName || "none",
    "",
    "Files:",
    normalizeFileList(session.files),
    "",
    "Commands:",
    normalizeCommandList(session.commands),
    "",
    "Status:",
    "Success",
  ].join("\n");
}

function formatFailure(session, error) {
  return [
    "Task failed.",
    "",
    "Step failed:",
    session.lastStep || "Unknown step",
    "",
    "Error:",
    error?.message || "Unknown error",
    "",
    "Possible cause:",
    "Check the current task input, project files, or Ollama availability.",
  ].join("\n");
}

function isAllowedTelegramUser(chatId) {
  const value = String(chatId || "");
  if (!value) return false;

  if (config.owner.telegramId && value === config.owner.telegramId) {
    return true;
  }

  if (config.allowedUsers.telegramIds.length > 0) {
    return config.allowedUsers.telegramIds.includes(value);
  }

  return Boolean(config.owner.telegramId) ? value === config.owner.telegramId : false;
}

function createTaskStream({ bot, chatId, sourceTag }) {
  const session = {
    active: false,
    completed: false,
    taskId: null,
    projectName: "",
    files: new Set(),
    commands: new Set(),
    lastStep: "",
    lastTerminalStepId: "",
    lastMilestoneKey: "",
    stillWorkingTimer: null,
  };

  const listeners = [];

  function track(eventName, handler) {
    studioEvents.on(eventName, handler);
    listeners.push([eventName, handler]);
  }

  function stop() {
    if (session.stillWorkingTimer) {
      clearInterval(session.stillWorkingTimer);
      session.stillWorkingTimer = null;
    }

    for (const [eventName, handler] of listeners) {
      studioEvents.off(eventName, handler);
    }
    listeners.length = 0;
  }

  async function sendMilestone(key, text) {
    if (!session.active || session.completed) {
      return;
    }

    if (session.lastMilestoneKey === key) {
      return;
    }

    session.lastMilestoneKey = key;
    await safeReply(bot, chatId, text);
  }

  track("task.start", async (payload) => {
    if (payload?.source !== sourceTag) {
      return;
    }

    session.active = true;
    session.taskId = payload.taskId;
    session.lastStep = "Task received";
    await safeReply(bot, chatId, `⚙️ Task received: ${payload.input || "Task started"}`);

    session.stillWorkingTimer = setInterval(() => {
      safeReply(bot, chatId, "⚙️ Still working...");
    }, STILL_WORKING_INTERVAL_MS);
  });

  track("step.start", async (payload) => {
    if (!session.active || payload?.taskId !== session.taskId) {
      return;
    }

    if (payload.projectName) {
      session.projectName = payload.projectName;
    }

    if (payload.tool === "project-create") {
      session.projectName = payload.input?.name || session.projectName;
      session.lastStep = `Creating project ${session.projectName || ""}`.trim();
      await sendMilestone(
        `project:${session.projectName || payload.stepId}`,
        `📁 Creating project: ${session.projectName || "project"}`
      );
      return;
    }

    if (payload.tool === "terminal-run") {
      const commandText = formatCommand(payload.input);
      if (commandText) {
        session.commands.add(commandText);
      }
      session.lastStep = commandText ? `Running ${commandText}` : "Running command";
      session.lastTerminalStepId = payload.stepId || "";
      return;
    }

    session.lastStep = payload.tool || "Running step";
  });

  track("file.create", async (payload) => {
    if (!session.active || session.completed) {
      return;
    }

    if (payload.projectName) {
      session.projectName = payload.projectName;
    }

    const filePath = String(payload.path || "").trim();
    if (!filePath) {
      return;
    }

    session.files.add(filePath);
    session.lastStep = `Creating file ${filePath}`;
    await sendMilestone(`file.create:${filePath}`, `📁 Creating file: ${filePath}`);
  });

  track("file.update", async (payload) => {
    if (!session.active || session.completed) {
      return;
    }

    if (payload.projectName) {
      session.projectName = payload.projectName;
    }

    const filePath = String(payload.path || "").trim();
    if (!filePath) {
      return;
    }

    session.files.add(filePath);
    session.lastStep = `Writing code ${filePath}`;
    await sendMilestone(`file.update:${filePath}`, `✏️ Writing code: ${filePath}`);
  });

  track("terminal.output", async (payload) => {
    if (!session.active || session.completed || !session.lastTerminalStepId) {
      return;
    }

    if (payload.projectName) {
      session.projectName = payload.projectName;
    }

    await sendMilestone(
      `terminal:${session.lastTerminalStepId}`,
      `▶️ Running command: ${Array.from(session.commands).slice(-1)[0] || "command"}`
    );
  });

  track("task.done", async (payload) => {
    if (!session.active || payload?.taskId !== session.taskId) {
      return;
    }

    session.completed = true;
    session.lastStep = "Task completed";
    if (payload.activeProject) {
      session.projectName = payload.activeProject;
    }

    stop();
    await safeReply(bot, chatId, formatSummary(session));
  });

  track("task.error", async (payload) => {
    if (!session.active || payload?.taskId !== session.taskId) {
      return;
    }

    session.completed = true;
    stop();
    await safeReply(bot, chatId, formatFailure(session, { message: payload.error }));
  });

  return {
    stop,
    isCompleted() {
      return session.completed;
    },
  };
}

function createTelegramAdapter({ engine }) {
  let bot = null;
  let unauthorizedCount = 0;

  return {
    name: "telegram",
    isCore: false,
    async start({ updateStatus }) {
      if (!config.channels.telegram.enabled) {
        updateStatus({
          enabled: false,
          status: "disabled",
          label: "Telegram disabled",
        });
        return;
      }

      if (!config.channels.telegram.token) {
        updateStatus({
          enabled: false,
          status: "disabled",
          label: "Telegram token missing",
        });
        return;
      }

      if (!config.owner.telegramId && config.allowedUsers.telegramIds.length === 0) {
        updateStatus({
          enabled: false,
          status: "restricted",
          label: "Add an owner or allowed Telegram user IDs",
        });
        return;
      }

      bot = new TelegramBot(config.channels.telegram.token, { polling: true });

      try {
        const me = await bot.getMe();
        updateStatus({
          enabled: true,
          status: "ready",
          label: `Telegram ready @${me.username || me.first_name || "bot"}`,
        });
      } catch (error) {
        updateStatus({
          enabled: false,
          status: "error",
          label: `Telegram auth failed: ${error.message}`,
        });

        try {
          await bot.stopPolling();
        } catch {}
        bot = null;
        return;
      }

      bot.on("message", async (msg) => {
        let typing = null;
        let stream = null;

        try {
          if (!msg || typeof msg.text !== "string" || !msg.text.trim()) {
            return;
          }

          const chatId = msg.chat?.id;
          if (!isAllowedTelegramUser(chatId)) {
            await safeReply(bot, chatId, "Access denied for this Telegram account.");
            return;
          }

          await bot.sendChatAction(chatId, "typing");
          typing = setInterval(() => {
            bot.sendChatAction(chatId, "typing").catch(() => {});
          }, 3000);

          const sourceTag = `telegram:${chatId}:${Date.now()}`;
          stream = createTaskStream({ bot, chatId, sourceTag });

          await engine.submit(msg.text, {
            source: sourceTag,
          });
        } catch (error) {
          const chatId = msg?.chat?.id;
          if (chatId && (!stream || !stream.isCompleted())) {
            await safeReply(bot, chatId, formatFailure({ lastStep: "Task execution" }, error));
          }
        } finally {
          if (typing) clearInterval(typing);
          if (stream) {
            stream.stop();
          }
        }
      });

      bot.on("polling_error", async (error) => {
        const message = error?.message || String(error);
        if (!message.includes("401")) {
          updateStatus({
            enabled: true,
            status: "warning",
            label: `Telegram warning: ${message}`,
          });
          return;
        }

        unauthorizedCount += 1;
        if (unauthorizedCount < config.channels.telegram.maxUnauthorizedErrors) {
          updateStatus({
            enabled: true,
            status: "warning",
            label: "Telegram authorization warning",
          });
          return;
        }

        updateStatus({
          enabled: false,
          status: "error",
          label: "Telegram token became unauthorized",
        });

        try {
          await bot.stopPolling();
        } catch {}
        bot = null;
      });
    },
    async stop() {
      if (!bot) return;

      try {
        await bot.stopPolling();
      } catch {}
      bot = null;
    },
  };
}

module.exports = { createTelegramAdapter };
