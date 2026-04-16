const test = require("node:test");
const assert = require("node:assert");
const proxyquire = require("proxyquire").noCallThru();

test("ChannelManager", async (t) => {
  let emittedEvents = [];
  const mockStudioEvents = {
    emit: (event, payload) => {
      emittedEvents.push({ event, payload });
    },
  };

  const createMockAdapter = (name, isCore, hasRegisterRoutes = true) => {
    return {
      name,
      isCore,
      registerRoutesCalled: false,
      startCalled: false,
      stopCalled: false,
      startOptions: null,
      shouldFailStart: false,

      registerRoutes: hasRegisterRoutes ? function(app) {
        this.registerRoutesCalled = true;
        this.app = app;
      } : undefined,

      start: async function(options) {
        this.startCalled = true;
        this.startOptions = options;
        if (this.shouldFailStart) {
          throw new Error(`${name} start failed`);
        }
      },

      stop: async function() {
        this.stopCalled = true;
      }
    };
  };

  const mockUiAdapter = createMockAdapter("ui", true);
  const mockTelegramAdapter = createMockAdapter("telegram", false);
  const mockWhatsAppAdapter = createMockAdapter("whatsapp", false, false); // no registerRoutes
  const mockDiscordAdapter = createMockAdapter("discord", false);

  const { createChannelManager } = proxyquire("../../src/gateway/channel-manager", {
    "../studio/studio-events": mockStudioEvents,
    "./ui-adapter": { createUiAdapter: () => mockUiAdapter },
    "./telegram-adapter": { createTelegramAdapter: () => mockTelegramAdapter },
    "./whatsapp-adapter": { createWhatsAppAdapter: () => mockWhatsAppAdapter },
    "./discord-adapter": { createDiscordAdapter: () => mockDiscordAdapter },
  });

  t.beforeEach(() => {
    emittedEvents = [];
    [mockUiAdapter, mockTelegramAdapter, mockWhatsAppAdapter, mockDiscordAdapter].forEach(adapter => {
      adapter.registerRoutesCalled = false;
      adapter.startCalled = false;
      adapter.stopCalled = false;
      adapter.startOptions = null;
      adapter.shouldFailStart = false;
    });
  });

  await t.test("constructor initializes correctly", () => {
    const onStatusChange = () => {};
    const engine = {};
    const manager = createChannelManager({ engine, onStatusChange });

    assert.strictEqual(manager.onStatusChange, onStatusChange);
    assert.strictEqual(manager.adapters.length, 4);
    assert.deepStrictEqual(manager.channelStates, {});
  });

  await t.test("updateStatus updates state, emits event, and calls callback", () => {
    let callbackCalledWith = null;
    const manager = createChannelManager({
      engine: {},
      onStatusChange: (statuses) => {
        callbackCalledWith = statuses;
      }
    });

    manager.updateStatus("telegram", { enabled: true, status: "ready" });

    // Check state updated
    assert.deepStrictEqual(manager.channelStates.telegram, {
      name: "telegram",
      enabled: true,
      status: "ready"
    });

    // Check event emitted
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].event, "channel.status");
    assert.deepStrictEqual(emittedEvents[0].payload, {
      name: "telegram",
      enabled: true,
      status: "ready"
    });

    // Check callback called
    assert.deepStrictEqual(callbackCalledWith, {
      telegram: {
        name: "telegram",
        enabled: true,
        status: "ready"
      }
    });
  });

  await t.test("updateStatus merges correctly with existing state", () => {
    const manager = createChannelManager({ engine: {} });

    manager.updateStatus("ui", { enabled: true });
    manager.updateStatus("ui", { status: "ready" });

    assert.deepStrictEqual(manager.channelStates.ui, {
      name: "ui",
      enabled: true,
      status: "ready"
    });
  });

  await t.test("registerRoutes calls registerRoutes on adapters that support it", () => {
    const manager = createChannelManager({ engine: {} });
    const mockApp = { isApp: true };

    manager.registerRoutes(mockApp);

    assert.strictEqual(mockUiAdapter.registerRoutesCalled, true);
    assert.strictEqual(mockUiAdapter.app, mockApp);
    assert.strictEqual(mockTelegramAdapter.registerRoutesCalled, true);
    assert.strictEqual(mockWhatsAppAdapter.registerRoutesCalled, false); // doesn't have it
    assert.strictEqual(mockDiscordAdapter.registerRoutesCalled, true);
  });

  await t.test("startCoreChannels starts only core adapters", async () => {
    const manager = createChannelManager({ engine: {} });

    await manager.startCoreChannels();

    assert.strictEqual(mockUiAdapter.startCalled, true);
    assert.strictEqual(mockTelegramAdapter.startCalled, false);
    assert.strictEqual(mockWhatsAppAdapter.startCalled, false);
    assert.strictEqual(mockDiscordAdapter.startCalled, false);

    // Test that the updateStatus callback works
    mockUiAdapter.startOptions.updateStatus({ status: "running" });
    assert.strictEqual(manager.channelStates.ui.status, "running");
  });

  await t.test("startCoreChannels handles start errors", async () => {
    const manager = createChannelManager({ engine: {} });
    mockUiAdapter.shouldFailStart = true;

    await manager.startCoreChannels();

    assert.strictEqual(mockUiAdapter.startCalled, true);
    assert.strictEqual(manager.channelStates.ui.enabled, false);
    assert.strictEqual(manager.channelStates.ui.status, "error");
    assert.strictEqual(manager.channelStates.ui.label, "ui start failed");
  });

  await t.test("startOptionalChannels starts only optional adapters", async () => {
    const manager = createChannelManager({ engine: {} });

    await manager.startOptionalChannels();

    assert.strictEqual(mockUiAdapter.startCalled, false);
    assert.strictEqual(mockTelegramAdapter.startCalled, true);
    assert.strictEqual(mockWhatsAppAdapter.startCalled, true);
    assert.strictEqual(mockDiscordAdapter.startCalled, true);

    // Test that the updateStatus callback works
    mockTelegramAdapter.startOptions.updateStatus({ status: "running" });
    assert.strictEqual(manager.channelStates.telegram.status, "running");
  });

  await t.test("startOptionalChannels handles start errors", async () => {
    const manager = createChannelManager({ engine: {} });
    mockTelegramAdapter.shouldFailStart = true;

    await manager.startOptionalChannels();

    assert.strictEqual(mockTelegramAdapter.startCalled, true);
    assert.strictEqual(manager.channelStates.telegram.enabled, false);
    assert.strictEqual(manager.channelStates.telegram.status, "error");
    assert.strictEqual(manager.channelStates.telegram.label, "telegram start failed");

    // Others should still be started
    assert.strictEqual(mockWhatsAppAdapter.startCalled, true);
  });

  await t.test("stop calls stop on adapters in reverse order", async () => {
    const manager = createChannelManager({ engine: {} });

    // Add some tracking for order
    let stopOrder = [];
    mockUiAdapter.stop = async () => { stopOrder.push("ui"); };
    mockTelegramAdapter.stop = async () => { stopOrder.push("telegram"); };
    mockWhatsAppAdapter.stop = async () => { stopOrder.push("whatsapp"); };
    mockDiscordAdapter.stop = async () => { stopOrder.push("discord"); };

    await manager.stop();

    // The order should be the reverse of how they are in manager.adapters
    // manager.adapters = [ui, telegram, whatsapp, discord]
    assert.deepStrictEqual(stopOrder, ["discord", "whatsapp", "telegram", "ui"]);
  });

  await t.test("stop handles stop errors gracefully", async () => {
    const manager = createChannelManager({ engine: {} });

    mockTelegramAdapter.stop = async () => { throw new Error("stop error"); };
    mockUiAdapter.stop = async () => { mockUiAdapter.stopCalled = true; };

    // Should not throw
    await manager.stop();

    // Should still have called stop on ui which is after telegram in reverse order
    assert.strictEqual(mockUiAdapter.stopCalled, true);
  });

  await t.test("getStatuses returns copy of state", () => {
    const manager = createChannelManager({ engine: {} });
    manager.updateStatus("ui", { enabled: true });

    const statuses = manager.getStatuses();
    assert.deepStrictEqual(statuses, { ui: { name: "ui", enabled: true } });

    // Verify it's a copy
    assert.notStrictEqual(statuses, manager.channelStates);
  });
});
