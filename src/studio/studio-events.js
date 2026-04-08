const { EventEmitter } = require("events");

const studioEvents = new EventEmitter();
studioEvents.setMaxListeners(100);

module.exports = studioEvents;
