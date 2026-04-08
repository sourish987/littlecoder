const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CONFIG_PATH = path.join(__dirname, "config.json");

async function runDemo() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log("LittleCoder is not configured yet. Run `npm start` first.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const port = Number(raw.studio?.port || 3001);

  try {
    const response = await axios.post(`http://localhost:${port}/api/chat`, {
      message: "create a simple website",
    });

    console.log("LittleCoder demo submitted.");
    console.log(response.data.reply || "Open Studio to watch the Worker.");
  } catch (error) {
    console.log("LittleCoder is not running yet. Start it with `npm start` and try again.");
    process.exit(1);
  }
}

runDemo();
