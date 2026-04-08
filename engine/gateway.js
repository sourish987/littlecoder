const controller = require("./controller");

const action = process.argv[2];
const validActions = new Set(["start", "stop", "status", "restart"]);

if (!action || !validActions.has(action)) {
  console.log("LittleCoder Engine");
  console.log("Commands: start stop status restart");
  process.exit(action ? 1 : 0);
}

Promise.resolve(controller[action]())
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
