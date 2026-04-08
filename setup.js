const fs = require("fs");
const path = require("path");
const express = require("express");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");

const ROOT_DIR = __dirname;
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(ROOT_DIR, "config.example.json");
const SETUP_PORT = 3210;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "http://localhost:11434";
  }

  return trimmed
    .replace(/\/api\/generate$/, "")
    .replace(/\/api\/tags$/, "");
}

function ollamaTagsUrl(url) {
  return `${normalizeUrl(url)}/api/tags`;
}

function loadTemplateConfig() {
  return readJson(CONFIG_EXAMPLE_PATH, {
    brain: {
      provider: "ollama",
      enabled: true,
      url: "http://localhost:11434",
      model: "qwen2.5-coder:7b-instruct-q4_K_M",
      timeoutMs: 45000,
    },
    factory: {
      root: "factory/projects",
      exportEnabled: false,
      retentionMaxTasks: 200,
    },
    studio: {
      port: 3001,
      autoOpen: true,
    },
    executionMode: "headless",
    owner: {
      telegramId: "",
      phoneNumber: "",
      discordId: "",
    },
    allowedUsers: {
      telegramIds: [],
      phoneNumbers: [],
      discordIds: [],
    },
    channels: {
      telegram: {
        enabled: false,
        token: "",
        ownerId: "",
        allowedUserIds: [],
        maxUnauthorizedErrors: 3,
      },
      whatsapp: {
        enabled: false,
        ownerNumber: "",
        allowedNumbers: [],
      },
      discord: {
        enabled: false,
        token: "",
        ownerId: "",
        allowedUserIds: [],
      },
    },
    worker: {
      startTimeoutMs: 5000,
      stepTimeoutMs: 30000,
      maxRetries: 1,
      retryDelayMs: 1000,
      maxOutputChars: 20000,
    },
  });
}

function loadExistingConfig() {
  return readJson(CONFIG_PATH, loadTemplateConfig());
}

function configExistsAndValid() {
  const raw = readJson(CONFIG_PATH);
  if (!raw) return false;

  return Boolean(
    raw.brain &&
      raw.brain.url &&
      raw.brain.model &&
      raw.factory &&
      raw.factory.root &&
      raw.studio &&
      raw.studio.port
  );
}

function parseIdList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function validateOllamaConnection({ url, model }) {
  try {
    const response = await axios.get(ollamaTagsUrl(url), { timeout: 5000 });
    const models = Array.isArray(response.data?.models) ? response.data.models : [];
    const names = models
      .map((entry) => String(entry.name || "").trim())
      .filter(Boolean);

    const found = names.includes(model);
    if (!found) {
      throw new Error(`Model not found in Ollama: ${model}`);
    }

    return {
      ok: true,
      model,
      availableModels: names.slice(0, 20),
    };
  } catch (error) {
    if (error?.response?.status) {
      throw new Error(`Ollama responded with status ${error.response.status}`);
    }

    throw new Error(
      error?.message
        ? `Could not reach Ollama: ${error.message}`
        : "Could not reach Ollama at the selected URL"
    );
  }
}

async function validateTelegramToken(token) {
  try {
    const bot = new TelegramBot(String(token || "").trim(), { polling: false });
    const me = await bot.getMe();
    return {
      ok: true,
      username: me.username || "",
      title: me.first_name || me.username || "Telegram bot",
    };
  } catch (error) {
    throw new Error(error?.message || "Telegram token validation failed");
  }
}

function buildConfigFromInput(input) {
  const template = loadTemplateConfig();
  const workspaceRoot = String(input.workspaceRoot || "").trim() || template.factory.root;
  const telegramEnabled = input.telegramEnabled === true;
  const telegramAllowedUserIds = parseIdList(input.telegramAllowedUserIds);
  const telegramOwnerId = String(input.telegramOwnerId || "").trim();

  return {
    ...template,
    brain: {
      ...template.brain,
      url: normalizeUrl(input.ollamaUrl || template.brain.url),
      model: String(input.ollamaModel || template.brain.model).trim(),
    },
    factory: {
      ...template.factory,
      root: workspaceRoot,
    },
    studio: {
      ...template.studio,
      port: Number(input.studioPort || template.studio.port),
      autoOpen: input.autoOpen !== false,
    },
    executionMode: input.executionMode === "visual" ? "visual" : "headless",
    owner: {
      ...template.owner,
      telegramId: telegramOwnerId,
    },
    allowedUsers: {
      ...template.allowedUsers,
      telegramIds: telegramAllowedUserIds,
    },
    channels: {
      ...template.channels,
      telegram: {
        ...template.channels.telegram,
        enabled: telegramEnabled,
        token: telegramEnabled ? String(input.telegramToken || "").trim() : "",
        ownerId: telegramOwnerId,
        allowedUserIds: telegramAllowedUserIds,
      },
    },
  };
}

function openBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function setupHtml(defaults, autoStart) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>LittleCoder Setup</title>
  <style>
    :root {
      --bg: #f5f0e8;
      --panel: #fffdf8;
      --ink: #201713;
      --accent: #bf5f2f;
      --line: #dbcab7;
      --soft: #776252;
      --ok: #2f8f4e;
      --warn: #aa3f2b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: radial-gradient(circle at top, #fff6df, var(--bg));
      color: var(--ink);
    }
    .shell {
      max-width: 920px;
      margin: 0 auto;
      padding: 28px 20px 40px;
    }
    .hero {
      margin-bottom: 18px;
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 38px;
    }
    .hero p {
      margin: 0;
      color: var(--soft);
      font-size: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 12px 28px rgba(62, 37, 17, 0.08);
      margin-bottom: 14px;
    }
    .card h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      color: var(--soft);
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      font: inherit;
      background: #fffefb;
      color: var(--ink);
    }
    textarea { min-height: 78px; resize: vertical; }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-size: 14px;
    }
    .toggle input {
      width: auto;
      transform: scale(1.2);
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    button {
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      font: inherit;
      cursor: pointer;
    }
    .primary {
      background: var(--accent);
      color: white;
    }
    .secondary {
      background: rgba(191, 95, 47, 0.08);
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .note {
      color: var(--soft);
      font-size: 13px;
      margin-top: 8px;
    }
    .status {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.7);
      white-space: pre-wrap;
      font-size: 13px;
    }
    .status.ok { border-color: rgba(47, 143, 78, 0.28); background: rgba(47, 143, 78, 0.08); }
    .status.error { border-color: rgba(170, 63, 43, 0.28); background: rgba(170, 63, 43, 0.08); }
    .hidden { display: none; }
    @media (max-width: 760px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <h1>LittleCoder Setup</h1>
      <p>Get the Worker ready with Studio first. Telegram is optional and can be skipped.</p>
    </div>

    <form id="setupForm">
      <div class="card">
        <h2>Step 1. Core Setup</h2>
        <div class="grid">
          <label>
            Workspace directory
            <input id="workspaceRoot" value="${String(defaults.factory?.root || "factory/projects").replace(/"/g, "&quot;")}" />
          </label>
          <label>
            Studio port
            <input id="studioPort" type="number" min="1" max="65535" value="${Number(defaults.studio?.port || 3001)}" />
          </label>
          <label>
            Ollama URL
            <input id="ollamaUrl" value="${String(defaults.brain?.url || "http://localhost:11434").replace(/"/g, "&quot;")}" />
          </label>
          <label>
            Model name
            <input id="ollamaModel" value="${String(defaults.brain?.model || "").replace(/"/g, "&quot;")}" />
          </label>
          <label>
            Execution mode
            <select id="executionMode">
              <option value="headless"${defaults.executionMode !== "visual" ? " selected" : ""}>Headless</option>
              <option value="visual"${defaults.executionMode === "visual" ? " selected" : ""}>Visual</option>
            </select>
          </label>
        </div>
        <div class="actions">
          <button type="button" class="secondary" id="testOllama">Test Ollama</button>
        </div>
        <div class="note">LittleCoder needs Ollama installed and the selected model available before first use.</div>
      </div>

      <div class="card">
        <h2>Step 2. Optional Telegram</h2>
        <label class="toggle">
          <input id="telegramEnabled" type="checkbox"${defaults.channels?.telegram?.enabled ? " checked" : ""} />
          Configure Telegram now
        </label>
        <div id="telegramFields" class="${defaults.channels?.telegram?.enabled ? "" : "hidden"}">
          <div class="grid">
            <label>
              Telegram bot token
              <input id="telegramToken" value="${String(defaults.channels?.telegram?.token || "").replace(/"/g, "&quot;")}" />
            </label>
            <label>
              Owner Telegram chat ID
              <input id="telegramOwnerId" value="${String(defaults.owner?.telegramId || "").replace(/"/g, "&quot;")}" />
            </label>
          </div>
          <label>
            Allowed Telegram chat IDs
            <textarea id="telegramAllowedUserIds" placeholder="One chat ID per line or comma separated">${(defaults.allowedUsers?.telegramIds || []).join("\\n")}</textarea>
          </label>
          <div class="actions">
            <button type="button" class="secondary" id="testTelegram">Test Telegram</button>
          </div>
          <div class="note">If you skip Telegram, LittleCoder still works fully through Studio chat.</div>
        </div>
      </div>

      <div class="card">
        <h2>Step 3. Finish</h2>
        <div class="actions">
          <button type="submit" class="primary">${autoStart ? "Save and Start LittleCoder" : "Save Configuration"}</button>
        </div>
        <div class="note">After setup you can talk to LittleCoder directly in Studio. Try a first task like "create a simple website".</div>
      </div>
    </form>

    <div id="statusBox" class="status">Waiting for input...</div>
  </div>

  <script>
    const autoStart = ${autoStart ? "true" : "false"};

    function payload() {
      return {
        workspaceRoot: document.getElementById("workspaceRoot").value,
        studioPort: Number(document.getElementById("studioPort").value),
        ollamaUrl: document.getElementById("ollamaUrl").value,
        ollamaModel: document.getElementById("ollamaModel").value,
        executionMode: document.getElementById("executionMode").value,
        telegramEnabled: document.getElementById("telegramEnabled").checked,
        telegramToken: document.getElementById("telegramToken").value,
        telegramOwnerId: document.getElementById("telegramOwnerId").value,
        telegramAllowedUserIds: document.getElementById("telegramAllowedUserIds").value
      };
    }

    function setStatus(text, kind) {
      const box = document.getElementById("statusBox");
      box.textContent = text;
      box.className = "status" + (kind ? " " + kind : "");
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Request failed");
      }

      return payload;
    }

    document.getElementById("telegramEnabled").addEventListener("change", (event) => {
      document.getElementById("telegramFields").className = event.target.checked ? "" : "hidden";
    });

    document.getElementById("testOllama").addEventListener("click", async () => {
      setStatus("Testing Ollama connection...", "");
      try {
        const result = await postJson("/api/validate/ollama", payload());
        setStatus("Ollama READY\\nModel: " + result.model, "ok");
      } catch (error) {
        setStatus("Ollama check failed\\n" + error.message + "\\nInstall Ollama, start it, and pull the selected model.", "error");
      }
    });

    document.getElementById("testTelegram").addEventListener("click", async () => {
      setStatus("Testing Telegram token...", "");
      try {
        const result = await postJson("/api/validate/telegram", payload());
        setStatus("Telegram READY\\nBot: " + result.title, "ok");
      } catch (error) {
        setStatus("Telegram check failed\\n" + error.message, "error");
      }
    });

    document.getElementById("setupForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("Saving configuration...", "");

      try {
        const result = await postJson("/api/configure", {
          ...payload(),
          autoStart
        });

        setStatus(result.message, "ok");
        if (result.studioUrl) {
          setTimeout(() => {
            window.location = result.studioUrl;
          }, 1200);
        }
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  </script>
</body>
</html>`;
}

async function startSetupServer(options = {}) {
  const autoStart = options.autoStart === true;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(setupHtml(loadExistingConfig(), autoStart));
  });

  app.post("/api/validate/ollama", async (req, res) => {
    try {
      const payload = await validateOllamaConnection({
        url: req.body?.ollamaUrl,
        model: String(req.body?.ollamaModel || "").trim(),
      });
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/validate/telegram", async (req, res) => {
    try {
      const payload = await validateTelegramToken(req.body?.telegramToken);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  const server = app.listen(SETUP_PORT, () => {
    console.log(`LittleCoder setup: http://localhost:${SETUP_PORT}`);
    openBrowser(`http://localhost:${SETUP_PORT}`);
  });

  app.post("/api/configure", async (req, res) => {
    try {
      const workspaceRoot = String(req.body?.workspaceRoot || "").trim();
      const ollamaModel = String(req.body?.ollamaModel || "").trim();
      const studioPort = Number(req.body?.studioPort);

      if (!workspaceRoot) {
        throw new Error("Workspace directory is required");
      }

      if (!ollamaModel) {
        throw new Error("Ollama model is required");
      }

      if (!Number.isInteger(studioPort) || studioPort <= 0 || studioPort > 65535) {
        throw new Error("Studio port must be a valid number");
      }

      await validateOllamaConnection({
        url: req.body?.ollamaUrl,
        model: ollamaModel,
      });

      if (req.body?.telegramEnabled === true) {
        const telegramToken = String(req.body?.telegramToken || "").trim();
        const telegramOwnerId = String(req.body?.telegramOwnerId || "").trim();

        if (!telegramToken) {
          throw new Error("Telegram token is required when Telegram is enabled");
        }

        if (!telegramOwnerId) {
          throw new Error("Owner Telegram chat ID is required when Telegram is enabled");
        }

        await validateTelegramToken(telegramToken);
      }

      const nextConfig = buildConfigFromInput(req.body || {});
      writeJson(CONFIG_PATH, nextConfig);

      let message = [
        "LittleCoder configuration saved.",
        `Studio will run on http://localhost:${nextConfig.studio.port}`,
        nextConfig.channels.telegram.enabled ? "Telegram enabled." : "Telegram skipped.",
        'Try: create a simple website',
      ].join("\\n");

      if (req.body?.autoStart === true) {
        const controller = require("./engine/controller");
        await controller.start();
        message = [
          "LittleCoder READY",
          `Studio URL: http://localhost:${nextConfig.studio.port}`,
          "Worker READY",
          nextConfig.channels.telegram.enabled ? "Telegram: enabled" : "Telegram: disabled",
          'Try: create a simple website',
        ].join("\\n");
      }

      res.json({
        ok: true,
        message,
        studioUrl: `http://localhost:${nextConfig.studio.port}`,
      });

      if (req.body?.autoStart === true) {
        setTimeout(() => {
          server.close(() => process.exit(0));
        }, 1500);
      }
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return server;
}

if (require.main === module) {
  startSetupServer({
    autoStart: process.argv.includes("--start"),
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CONFIG_PATH,
  configExistsAndValid,
  startSetupServer,
};
