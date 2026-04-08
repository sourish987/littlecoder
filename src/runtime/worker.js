const fs = require("fs");
const config = require("../infra/config");
const engine = require("../engine");
const studioEvents = require("../studio/studio-events");
const { startStudioServer } = require("../studio/studio-server");
const { createChannelManager } = require("../gateway/channel-manager");

let channelManager = null;
let readinessState = {
  ready: false,
  healthy: false,
  status: "starting",
};
let channelStates = {};

function writeReadiness(state = readinessState) {
  fs.writeFileSync(
    config.paths.readiness,
    JSON.stringify(
      {
        pid: process.pid,
        at: new Date().toISOString(),
        studioUrl: `http://localhost:${config.studio.port}`,
        channels: channelStates,
        ...state,
      },
      null,
      2
    )
  );
}

function updateReadiness(patch) {
  readinessState = {
    ...readinessState,
    ...patch,
  };
  writeReadiness(readinessState);
}

async function shutdown(code = 0, reason = "stopped") {
  updateReadiness({
    ready: false,
    healthy: false,
    status: reason,
  });

  if (channelManager) {
    try {
      await channelManager.stop();
    } catch {}
  }

  if (fs.existsSync(config.paths.workerPid)) {
    fs.unlinkSync(config.paths.workerPid);
  }

  process.exit(code);
}

function bindFatalHandlers() {
  process.on("unhandledRejection", (error) => {
    studioEvents.emit("worker.state", {
      status: "unhandled-rejection",
      healthy: false,
      ready: false,
    });
    shutdown(1, error?.message || "unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    studioEvents.emit("worker.state", {
      status: "uncaught-exception",
      healthy: false,
      ready: false,
    });
    shutdown(1, error?.message || "uncaughtException");
  });

  process.on("SIGINT", () => shutdown(0, "sigint"));
  process.on("SIGTERM", () => shutdown(0, "sigterm"));
}

async function startWorker() {
  bindFatalHandlers();
  fs.writeFileSync(config.paths.workerPid, String(process.pid));

  updateReadiness({
    ready: false,
    healthy: false,
    status: "starting",
  });

  channelManager = createChannelManager({
    engine,
    onStatusChange: (statuses) => {
      channelStates = statuses;
      writeReadiness();
    },
  });

  startStudioServer({
    registerRoutes(app) {
      channelManager.registerRoutes(app);
    },
  });

  await channelManager.startCoreChannels();

  updateReadiness({
    ready: true,
    healthy: true,
    status: "ready",
    engineInitialized: true,
    studioReady: true,
    uiChatReady: true,
  });

  studioEvents.emit("worker.state", {
    status: "ready",
    healthy: true,
    ready: true,
  });

  Promise.resolve(channelManager.startOptionalChannels()).catch((error) => {
    studioEvents.emit("worker.state", {
      status: "channel-warning",
      healthy: true,
      ready: true,
      detail: error.message,
    });
  });
}

if (require.main === module) {
  startWorker().catch((error) => {
    writeReadiness({
      ready: false,
      healthy: false,
      status: error.message,
    });
    process.exit(78);
  });
}

module.exports = { startWorker };
