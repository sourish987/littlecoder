const { createTelegramAdapter } = require("./telegram-adapter");

function createTelegramService(options = {}) {
  return createTelegramAdapter(options);
}

module.exports = { createTelegramService };
