const { configExistsAndValid, startSetupServer } = require("./setup");

async function run() {
  if (!configExistsAndValid()) {
    console.log("LittleCoder setup is required.");
    await startSetupServer({ autoStart: true });
    return;
  }

  const controller = require("./engine/controller");
  await controller.start();
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
