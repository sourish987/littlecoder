const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config.json at ${CONFIG_PATH}`);
  }

  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stringValue(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim() || fallback;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => stringValue(entry))
    .filter(Boolean);
}

const raw = readConfigFile();
const factoryRoot = path.resolve(ROOT_DIR, raw.factory?.root || "factory/projects");
const logsDir = path.join(ROOT_DIR, "logs");
const pidsDir = path.join(ROOT_DIR, "pids");

ensureDir(factoryRoot);
ensureDir(logsDir);
ensureDir(pidsDir);

const owner = {
  telegramId: stringValue(raw.owner?.telegramId || raw.channels?.telegram?.ownerId),
  phoneNumber: stringValue(raw.owner?.phoneNumber || raw.channels?.whatsapp?.ownerNumber),
  discordId: stringValue(raw.owner?.discordId || raw.channels?.discord?.ownerId),
};

const allowedUsers = {
  telegramIds: stringArray(
    raw.allowedUsers?.telegramIds || raw.channels?.telegram?.allowedUserIds
  ),
  phoneNumbers: stringArray(
    raw.allowedUsers?.phoneNumbers || raw.channels?.whatsapp?.allowedNumbers
  ),
  discordIds: stringArray(
    raw.allowedUsers?.discordIds || raw.channels?.discord?.allowedUserIds
  ),
};

const channels = {
  studio: {
    enabled: true,
  },
  telegram: {
    enabled:
      raw.channels?.telegram?.enabled === true ||
      Boolean(stringValue(raw.channels?.telegram?.token || raw.telegram?.token)),
    token: stringValue(raw.channels?.telegram?.token || raw.telegram?.token),
    ownerId: owner.telegramId,
    allowedUserIds: allowedUsers.telegramIds,
    maxUnauthorizedErrors: numberValue(
      raw.channels?.telegram?.maxUnauthorizedErrors || raw.telegram?.maxUnauthorizedErrors,
      3
    ),
  },
  whatsapp: {
    enabled: raw.channels?.whatsapp?.enabled === true,
    ownerNumber: owner.phoneNumber,
    allowedNumbers: allowedUsers.phoneNumbers,
  },
  discord: {
    enabled: raw.channels?.discord?.enabled === true,
    token: stringValue(raw.channels?.discord?.token),
    ownerId: owner.discordId,
    allowedUserIds: allowedUsers.discordIds,
  },
};

const config = {
  rootDir: ROOT_DIR,
  configPath: CONFIG_PATH,
  brain: {
    provider: stringValue(raw.brain?.provider, "ollama"),
    enabled: raw.brain?.enabled !== false,
    url: stringValue(raw.brain?.url, "http://localhost:11434"),
    model: stringValue(raw.brain?.model, "qwen2.5-coder:7b-instruct-q4_K_M"),
    timeoutMs: numberValue(raw.brain?.timeoutMs, 45000),
  },
  factory: {
    root: factoryRoot,
    exportEnabled: raw.factory?.exportEnabled === true,
    retentionMaxTasks: numberValue(raw.factory?.retentionMaxTasks, 200),
  },
  studio: {
    port: numberValue(raw.studio?.port, 3001),
    autoOpen: raw.studio?.autoOpen !== false,
  },
  executionMode: raw.executionMode === "visual" ? "visual" : "headless",
  owner,
  allowedUsers,
  channels,
  telegram: {
    enabled: channels.telegram.enabled,
    token: channels.telegram.token,
    ownerId: channels.telegram.ownerId,
    allowedUserIds: channels.telegram.allowedUserIds,
    maxUnauthorizedErrors: channels.telegram.maxUnauthorizedErrors,
  },
  worker: {
    startTimeoutMs: numberValue(raw.worker?.startTimeoutMs, 5000),
    stepTimeoutMs: numberValue(raw.worker?.stepTimeoutMs, 30000),
    maxRetries: numberValue(raw.worker?.maxRetries, 1),
    retryDelayMs: numberValue(raw.worker?.retryDelayMs, 1000),
    maxOutputChars: numberValue(raw.worker?.maxOutputChars, 20000),
  },
  paths: {
    logs: logsDir,
    pids: pidsDir,
    factoryRoot,
    studioState: path.join(logsDir, "studio-state.json"),
    taskState: path.join(logsDir, "task-state.json"),
    engineLog: path.join(logsDir, "engine.log"),
    errorLog: path.join(logsDir, "error.log"),
    startupLock: path.join(pidsDir, "startup.lock"),
    readiness: path.join(pidsDir, "worker-ready.json"),
    workerPid: path.join(pidsDir, "worker.pid"),
    supervisorPid: path.join(pidsDir, "supervisor.pid")
  }
};

module.exports = config;
