function createWhatsAppAdapter() {
  return {
    name: "whatsapp",
    isCore: false,
    async start({ updateStatus }) {
      updateStatus({
        enabled: false,
        status: "disabled",
        label: "WhatsApp not implemented yet",
      });
    },
    async stop() {},
  };
}

module.exports = { createWhatsAppAdapter };
