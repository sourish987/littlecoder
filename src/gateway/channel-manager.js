const studioEvents = require("../studio/studio-events");
const { createUiAdapter } = require("./ui-adapter");
const { createTelegramAdapter } = require("./telegram-adapter");
const { createWhatsAppAdapter } = require("./whatsapp-adapter");
const { createDiscordAdapter } = require("./discord-adapter");

class ChannelManager {
  constructor({ engine, onStatusChange }) {
    this.onStatusChange = onStatusChange;
    this.adapters = [
      createUiAdapter({ engine }),
      createTelegramAdapter({ engine }),
      createWhatsAppAdapter(),
      createDiscordAdapter(),
    ];
    this.channelStates = {};
  }

  updateStatus(name, patch) {
    this.channelStates[name] = {
      name,
      ...(this.channelStates[name] || {}),
      ...patch,
    };

    studioEvents.emit("channel.status", this.channelStates[name]);

    if (typeof this.onStatusChange === "function") {
      this.onStatusChange(this.getStatuses());
    }
  }

  registerRoutes(app) {
    for (const adapter of this.adapters) {
      if (typeof adapter.registerRoutes === "function") {
        adapter.registerRoutes(app);
      }
    }
  }

  async startCoreChannels() {
    for (const adapter of this.adapters) {
      if (adapter.isCore !== true || typeof adapter.start !== "function") {
        continue;
      }

      try {
        await adapter.start({
          updateStatus: (patch) => this.updateStatus(adapter.name, patch),
        });
      } catch (error) {
        this.updateStatus(adapter.name, {
          enabled: false,
          status: "error",
          label: error.message,
        });
      }
    }
  }

  async startOptionalChannels() {
    for (const adapter of this.adapters) {
      if (adapter.isCore === true || typeof adapter.start !== "function") {
        continue;
      }

      try {
        await adapter.start({
          updateStatus: (patch) => this.updateStatus(adapter.name, patch),
        });
      } catch (error) {
        this.updateStatus(adapter.name, {
          enabled: false,
          status: "error",
          label: error.message,
        });
      }
    }
  }

  async stop() {
    for (const adapter of [...this.adapters].reverse()) {
      if (typeof adapter.stop !== "function") {
        continue;
      }

      try {
        await adapter.stop();
      } catch {}
    }
  }

  getStatuses() {
    return { ...this.channelStates };
  }
}

function createChannelManager(options) {
  return new ChannelManager(options);
}

module.exports = { createChannelManager };
