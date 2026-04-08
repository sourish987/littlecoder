const axios = require("axios");
const config = require("./src/infra/config");

function buildPrompt(task) {
  return `You are LittleCoder.
Return JSON only.

Available tools:
- project-create
- file-create
- file-write
- terminal-run

Output:
{"steps":[{"tool":"project-create","input":{"name":"testapp"}}]}

Task:
${task}`;
}

async function plan(task) {
  const taskText = String(task || "").trim();
  try {
    const parsed = JSON.parse(taskText);
    if (parsed && Array.isArray(parsed.steps)) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {}

  const response = await axios.post(
    config.brain.url,
    {
      model: config.brain.model,
      prompt: buildPrompt(taskText),
      stream: false,
    },
    { timeout: config.brain.timeoutMs }
  );

  return String(response?.data?.response || "").trim();
}

module.exports = { plan };
