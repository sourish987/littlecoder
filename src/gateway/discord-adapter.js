function createDiscordAdapter() {
  return {
    name: "discord",
    isCore: false,
    async start({ updateStatus }) {
      updateStatus({
        enabled: false,
        status: "disabled",
        label: "Discord not configured",
      });
    },
    async stop() {},
  };
}

module.exports = { createDiscordAdapter };
