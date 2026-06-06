const crypto = require("crypto");
const axios = require("axios");
const config = require("../infra/config");
const studioEvents = require("../studio/studio-events");
const TaskQueue = require("./task-queue");
const TaskStateStore = require("./task-state-store");
const TASK_STATES = require("./task-states");
const ExecutionAdapter = require("../executor/execution-adapter");
const {
  TaskError,
  RetryableTaskError,
  FatalTaskError,
} = require("./task-errors");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_CONVERSATION_TURNS = 12;

function ollamaGenerateUrl(rawUrl) {
  const normalized = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "http://localhost:11434/api/generate";
  }

  if (normalized.endsWith("/api/generate")) {
    return normalized;
  }

  return `${normalized}/api/generate`;
}

function buildPlannerPrompt(task, memory) {
  const profile = inferWebsiteTaskProfile(task);
  return `You are LittleCoder, a single AI software factory worker.
Return JSON only.
Do not wrap the JSON in markdown code fences.
Do not add explanations before or after the JSON.
Return either:
- { "steps": [...] }
- or just the steps array itself.

Available tools:
- project-create { "name": "projectName" }
- file-create { "path": "relative/path", "content": "optional" }
- file-write { "path": "relative/path", "content": "text" }
- terminal-run { "command": "node|npm|npx", "args": ["..."] }

Rules:
- All work happens inside the current factory project.
- Use project-create first when a new project is requested.
- Prefer file-create for new files and file-write for updates.
- Never use absolute paths.

Current project:
${memory.currentProject || "none"}

Recent conversation:
${recentConversationBlock(memory)}

Output schema:
{
  "steps": [
    { "id": "step-1", "tool": "project-create", "input": { "name": "testapp" } }
  ]
}

${taskSpecificPlannerGuidance(profile)}

Task:
${task}`;
}

function normalizeTaskText(task) {
  return String(task || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeInteractionMode(value) {
  const normalized = normalizeTaskText(value);
  if (normalized === "chat" || normalized === "build" || normalized === "auto") {
    return normalized;
  }

  return "auto";
}

function isLikelyBuildIntent(taskInput) {
  if (typeof taskInput === "object" && taskInput && Array.isArray(taskInput.steps)) {
    return true;
  }

  const normalized = normalizeTaskText(taskInput);
  if (!normalized) {
    return false;
  }

  if (inferWebsiteTaskProfile(normalized)) {
    return true;
  }

  const buildPatterns = [
    /\b(create|build|make|generate|scaffold)\b/,
    /\b(write|edit|update|modify|change|fix|refactor)\b/,
    /\b(run|start|execute|install)\b/,
    /\b(project|app|website|page|site|portfolio|calculator|todo)\b/,
    /\b(file|files|html|css|javascript|js|server|api|component)\b/,
  ];

  return buildPatterns.some((pattern) => pattern.test(normalized));
}

function isLikelyChatIntent(taskInput) {
  const normalized = normalizeTaskText(taskInput);
  if (!normalized) {
    return true;
  }

  const chatPatterns = [
    /^(hi|hello|hey|yo|hola)\b/,
    /\b(help|explain|brainstorm|discuss|guide|teach)\b/,
    /\bwhat\b/,
    /\bwhy\b/,
    /\bhow\b/,
    /\bcan you\b/,
    /\bshould i\b/,
    /\?$/,
  ];

  return chatPatterns.some((pattern) => pattern.test(normalized));
}

function createQuickReply(taskInput, mode = "auto") {
  const normalized = normalizeTaskText(taskInput);
  if (!normalized) {
    return {
      message: [
        "LittleCoder is ready.",
        "",
        "Try one of these build tasks:",
        "- create a simple website",
        "- create a todo website",
        "- create a personal portfolio",
        "- create a calculator webpage",
        "- create a landing page",
      ].join("\n"),
    };
  }

  if (mode === "build" && !isLikelyBuildIntent(normalized)) {
    return {
      message: [
        "Build mode is for real execution inside the factory workspace.",
        "",
        "Switch to Chat mode to talk with the model, or Auto mode to let LittleCoder decide.",
        "",
        "Try one of these build tasks:",
        "- create a simple website",
        "- create a todo website",
        "- create a personal portfolio",
        "- create a calculator webpage",
        "- create a landing page",
      ].join("\n"),
    };
  }

  return null;
}

function summarizeConversationText(text, maxLength = 220) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function rememberConversation(memory, role, text, metadata = {}) {
  const value = String(text || "").trim();
  if (!value) {
    return;
  }

  if (!Array.isArray(memory.conversation)) {
    memory.conversation = [];
  }

  memory.conversation.push({
    role,
    text: value,
    mode: metadata.mode || "",
    source: metadata.source || "",
    at: new Date().toISOString(),
  });

  if (memory.conversation.length > MAX_CONVERSATION_TURNS) {
    memory.conversation = memory.conversation.slice(-MAX_CONVERSATION_TURNS);
  }
}

function recentConversationBlock(memory) {
  const items = Array.isArray(memory?.conversation) ? memory.conversation.slice(-8) : [];
  if (!items.length) {
    return "none";
  }

  return items
    .map((entry) => {
      const role = entry.role === "user" ? "User" : "Worker";
      const mode = entry.mode ? ` [${entry.mode}]` : "";
      return `${role}${mode}: ${summarizeConversationText(entry.text)}`;
    })
    .join("\n");
}

function getLastConversationTurn(memory, role) {
  const items = Array.isArray(memory?.conversation) ? memory.conversation : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!role || items[index].role === role) {
      return items[index];
    }
  }

  return null;
}

function createContextualFollowUpReply(taskInput, memory, mode = "auto") {
  const normalized = normalizeTaskText(taskInput);
  const affirmative = new Set(["yes", "yeah", "yep", "ok", "okay", "sure", "do it", "go ahead"]);

  if (!affirmative.has(normalized)) {
    return null;
  }

  const lastWorker = getLastConversationTurn(memory, "worker");
  if (!lastWorker) {
    return null;
  }

  const lastWorkerText = normalizeTaskText(lastWorker.text);
  if (
    lastWorkerText.includes("build mode is for real execution") ||
    lastWorkerText.includes("try one of these build tasks") ||
    lastWorkerText.includes("switch to chat mode") ||
    lastWorkerText.includes("switch to build mode")
  ) {
    return {
      message: [
        mode === "build"
          ? "Great. Tell LittleCoder exactly what to build and it will execute it in the factory workspace."
          : "Great. Tell LittleCoder exactly what to build, or switch to Build mode if you want to execute right away.",
        "",
        "Good examples:",
        "- create a calculator webpage",
        "- create a simple website",
        "- create a todo website",
      ].join("\n"),
    };
  }

  if (
    memory.currentProject &&
    (
      lastWorkerText.includes("project created:") ||
      lastWorkerText.includes("file created:") ||
      lastWorkerText.includes("file updated:")
    )
  ) {
    return {
      message: [
        `Great. The current project is ${memory.currentProject}.`,
        "",
        mode === "build"
          ? "Tell LittleCoder the next change to execute."
          : "You can keep chatting about it here, or switch to Build mode and ask for the next change.",
        "",
        "Good follow-ups:",
        "- explain what you built",
        "- add buttons to the calculator",
        "- improve the styling",
      ].join("\n"),
    };
  }

  return null;
}

async function generateModelText(prompt) {
  const response = await axios.post(
    ollamaGenerateUrl(config.brain.url),
    {
      model: config.brain.model,
      prompt,
      stream: false,
    },
    { timeout: config.brain.timeoutMs }
  );

  return String(response?.data?.response || "").trim();
}

function buildChatPrompt(message, memory) {
  return `You are LittleCoder, a local AI coding worker speaking in Studio chat mode.
Respond like a direct local model terminal chat response.
Be helpful, clear, and concise.
Do not pretend you executed anything in chat mode.
If the user asks you to build or change files, explain that Build mode executes tasks and Auto mode can switch for them.

Current project:
${memory.currentProject || "none"}

Recent conversation:
${recentConversationBlock(memory)}

User message:
${message}`;
}

function buildAutoModePrompt(message, memory) {
  return `You are deciding how LittleCoder should handle one user message.
Return exactly one word:
- BUILD
- CHAT

Choose BUILD only if the message is asking LittleCoder to create, edit, run, fix, or execute project work.
Choose CHAT for greetings, questions, brainstorming, explanation, or normal conversation.

Recent conversation:
${recentConversationBlock(memory)}

Message:
${message}`;
}

function formatChatFailure(error) {
  const message = String(error?.message || "Local model response failed");

  if (/timeout/i.test(message)) {
    return "LittleCoder timed out while waiting for the local model. Make sure Ollama is running and try again.";
  }

  if (/Could not reach|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return "LittleCoder could not reach Ollama. Check that Ollama is running and the configured URL is correct.";
  }

  return `LittleCoder could not answer in chat mode right now: ${message}`;
}

async function createChatReply(taskInput, memory) {
  const contextualReply = createContextualFollowUpReply(taskInput, memory, "chat");
  if (contextualReply) {
    return contextualReply.message;
  }

  const quickReply = createQuickReply(taskInput, "chat");
  if (quickReply) {
    return quickReply.message;
  }

  const taskText = String(taskInput || "").trim();
  if (!taskText) {
    return "LittleCoder is ready.";
  }

  if (!config.brain.enabled) {
    return "Local model chat is disabled right now. Re-enable the brain in setup to talk with LittleCoder here.";
  }

  try {
    const reply = await generateModelText(buildChatPrompt(taskText, memory));
    return reply || "LittleCoder is ready. Ask a coding question or switch to Build mode to execute work.";
  } catch (error) {
    return formatChatFailure(error);
  }
}

async function decideAutoMode(taskInput, memory) {
  if (isLikelyBuildIntent(taskInput)) {
    return "build";
  }

  if (isLikelyChatIntent(taskInput)) {
    return "chat";
  }

  if (!config.brain.enabled) {
    return "build";
  }

  try {
    const raw = await generateModelText(buildAutoModePrompt(String(taskInput || "").trim(), memory));
    const decision = normalizeTaskText(raw);
    if (decision.includes("build")) {
      return "build";
    }
    if (decision.includes("chat")) {
      return "chat";
    }
  } catch {}

  return isLikelyBuildIntent(taskInput) ? "build" : "chat";
}

function slugifyProjectName(value) {
  return String(value || "website")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "website";
}

function inferWebsiteTaskProfile(task) {
  const normalized = normalizeTaskText(task);
  if (!normalized) {
    return null;
  }

  if (normalized.includes("todo website")) {
    return {
      type: "todo",
      projectName: "todo-website",
      label: "todo website",
      requiredFiles: ["index.html", "style.css", "script.js"],
    };
  }

  if (normalized.includes("calculator webpage") || normalized.includes("calculator website")) {
    return {
      type: "calculator",
      projectName: "calculator-webpage",
      label: "calculator webpage",
      requiredFiles: ["index.html", "style.css", "script.js"],
    };
  }

  if (normalized.includes("personal portfolio")) {
    return {
      type: "portfolio",
      projectName: "personal-portfolio",
      label: "personal portfolio website",
      requiredFiles: ["index.html", "style.css", "script.js"],
    };
  }

  if (normalized.includes("landing page")) {
    return {
      type: "landing",
      projectName: "landing-page",
      label: "landing page",
      requiredFiles: ["index.html", "style.css", "script.js"],
    };
  }

  if (normalized.includes("simple website") || normalized.includes("website")) {
    return {
      type: "simple",
      projectName: "simple-website",
      label: "simple website",
      requiredFiles: ["index.html", "style.css", "script.js"],
    };
  }

  return null;
}

function taskSpecificPlannerGuidance(profile) {
  if (!profile) {
    return "";
  }

  const lines = [
    "Website task guidance:",
    `- This task is a ${profile.label}.`,
    `- Prefer project name "${profile.projectName}".`,
    `- Create these files unless the task clearly needs fewer: ${profile.requiredFiles.join(", ")}.`,
    "- Use semantic HTML and responsive CSS.",
    "- For interactive pages, put behavior in script.js.",
    "- Write complete file contents. Do not leave TODO placeholders.",
    "- Do not reference files outside the project.",
  ];

  if (profile.type === "todo") {
    lines.push("- The website must support adding, completing, and deleting tasks.");
  }

  if (profile.type === "calculator") {
    lines.push("- The calculator must support basic operations and clear/reset.");
  }

  if (profile.type === "portfolio") {
    lines.push("- Include hero, about, projects, and contact sections.");
  }

  if (profile.type === "landing") {
    lines.push("- Include hero, features, social proof, and a clear call to action.");
  }

  return lines.join("\n");
}

function simpleWebsiteFiles() {
  return {
    "index.html": [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Simple Website</title>",
      '  <link rel="stylesheet" href="style.css" />',
      "</head>",
      "<body>",
      '  <main class="shell">',
      '    <section class="hero">',
      '      <p class="eyebrow">LittleCoder</p>',
      "      <h1>Build something clear, fast, and delightful.</h1>",
      "      <p>This starter site gives you a polished hero, feature cards, and a friendly call to action.</p>",
      '      <button id="ctaButton" class="cta">See the message</button>',
      '      <p id="ctaMessage" class="message">Ready when you are.</p>',
      "    </section>",
      '    <section class="grid">',
      '      <article class="card"><h2>Simple</h2><p>Readable layout with strong spacing and structure.</p></article>',
      '      <article class="card"><h2>Visible</h2><p>Easy to expand as you keep building in Studio.</p></article>',
      '      <article class="card"><h2>Local</h2><p>Works as a lightweight static website starter.</p></article>',
      "    </section>",
      "  </main>",
      '  <script src="script.js"></script>',
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "style.css": [
      ":root {",
      "  color-scheme: light;",
      "  --bg: #f4efe6;",
      "  --panel: #fffdf8;",
      "  --ink: #1f1a17;",
      "  --accent: #bf5f2f;",
      "  --line: #d8c9b5;",
      "}",
      "* { box-sizing: border-box; }",
      "body {",
      "  margin: 0;",
      "  font-family: Georgia, 'Times New Roman', serif;",
      "  background: radial-gradient(circle at top, #fff5dd, var(--bg));",
      "  color: var(--ink);",
      "}",
      ".shell { max-width: 980px; margin: 0 auto; padding: 48px 20px 72px; }",
      ".hero { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; padding: 36px; box-shadow: 0 18px 40px rgba(62, 37, 17, 0.08); }",
      ".eyebrow { letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); font-size: 12px; }",
      "h1 { margin: 0 0 12px; font-size: clamp(2.4rem, 6vw, 4.4rem); line-height: 0.95; }",
      ".hero p { font-size: 1.05rem; max-width: 58ch; }",
      ".cta { margin-top: 16px; padding: 12px 18px; border: 0; border-radius: 999px; background: var(--accent); color: white; font: inherit; cursor: pointer; }",
      ".message { min-height: 24px; color: #7b5e45; }",
      ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 22px; }",
      ".card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; }",
      "@media (max-width: 720px) { .hero { padding: 24px; } }",
      "",
    ].join("\n"),
    "script.js": [
      "const button = document.getElementById('ctaButton');",
      "const message = document.getElementById('ctaMessage');",
      "",
      "if (button && message) {",
      "  button.addEventListener('click', () => {",
      "    message.textContent = 'LittleCoder says: your simple website is ready to grow.';",
      "  });",
      "}",
      "",
    ].join("\n"),
  };
}

function todoWebsiteFiles() {
  return {
    "index.html": [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Todo Website</title>",
      '  <link rel="stylesheet" href="style.css" />',
      "</head>",
      "<body>",
      '  <main class="shell">',
      "    <h1>Todo Website</h1>",
      "    <p>Keep the day clear with a simple task list.</p>",
      '    <form id="todoForm" class="composer">',
      '      <input id="todoInput" type="text" placeholder="Add a task" autocomplete="off" />',
      '      <button type="submit">Add</button>',
      "    </form>",
      '    <ul id="todoList" class="todo-list"></ul>',
      "  </main>",
      '  <script src="script.js"></script>',
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "style.css": [
      ":root { --bg: #f4efe6; --panel: #fffdf8; --ink: #1f1a17; --accent: #bf5f2f; --line: #d8c9b5; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: var(--bg); color: var(--ink); }",
      ".shell { max-width: 720px; margin: 0 auto; padding: 48px 20px 72px; }",
      ".composer { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin: 20px 0; }",
      "input, button { font: inherit; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); }",
      "button { background: var(--accent); color: white; cursor: pointer; border: 0; }",
      ".todo-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }",
      ".todo-item { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }",
      ".todo-item.done .todo-text { text-decoration: line-through; color: #7b5e45; }",
      ".ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }",
      "",
    ].join("\n"),
    "script.js": [
      "const form = document.getElementById('todoForm');",
      "const input = document.getElementById('todoInput');",
      "const list = document.getElementById('todoList');",
      "let items = [];",
      "",
      "function render() {",
      "  list.innerHTML = '';",
      "  for (const item of items) {",
      "    const li = document.createElement('li');",
      "    li.className = `todo-item${item.done ? ' done' : ''}`;",
      "    li.innerHTML = `",
      "      <input type=\"checkbox\" ${item.done ? 'checked' : ''} />",
      "      <span class=\"todo-text\"></span>",
      "      <button class=\"ghost\" type=\"button\">Delete</button>",
      "    `;",
      "    li.querySelector('.todo-text').textContent = item.text;",
      "    li.querySelector('input').addEventListener('change', () => {",
      "      item.done = !item.done;",
      "      render();",
      "    });",
      "    li.querySelector('button').addEventListener('click', () => {",
      "      items = items.filter((entry) => entry !== item);",
      "      render();",
      "    });",
      "    list.appendChild(li);",
      "  }",
      "}",
      "",
      "form.addEventListener('submit', (event) => {",
      "  event.preventDefault();",
      "  const text = input.value.trim();",
      "  if (!text) return;",
      "  items.unshift({ text, done: false });",
      "  input.value = '';",
      "  render();",
      "});",
      "",
      "render();",
      "",
    ].join("\n"),
  };
}

function portfolioWebsiteFiles() {
  return {
    "index.html": [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Personal Portfolio</title>",
      '  <link rel="stylesheet" href="style.css" />',
      "</head>",
      "<body>",
      '  <header class="shell hero">',
      "    <p class=\"eyebrow\">Personal Portfolio</p>",
      "    <h1>Hi, I build thoughtful digital experiences.</h1>",
      "    <p class=\"lede\">This starter portfolio includes an intro, featured work, and a simple contact section.</p>",
      '    <a class="cta" href="#projects">View Projects</a>',
      "  </header>",
      '  <main class="shell stack">',
      '    <section id="about" class="panel"><h2>About</h2><p>I care about clean interfaces, helpful tools, and products people actually enjoy using.</p></section>',
      '    <section id="projects" class="panel"><h2>Projects</h2><div class="grid"><article class="card"><h3>Studio UI</h3><p>A visible AI workflow interface.</p></article><article class="card"><h3>Factory Workspace</h3><p>A safe place for generated code.</p></article><article class="card"><h3>Automation Tools</h3><p>Focused tools for fast iteration.</p></article></div></section>',
      '    <section id="contact" class="panel"><h2>Contact</h2><p>Say hello and start a conversation about your next product.</p><button id="contactButton" class="cta">Reveal email</button><p id="contactText" class="contact-text"></p></section>',
      "  </main>",
      '  <script src="script.js"></script>',
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "style.css": [
      ":root { --bg: #f4efe6; --panel: #fffdf8; --ink: #1f1a17; --accent: #bf5f2f; --line: #d8c9b5; --soft: #7b5e45; }",
      "* { box-sizing: border-box; }",
      "html { scroll-behavior: smooth; }",
      "body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: radial-gradient(circle at top, #fff5dd, var(--bg)); color: var(--ink); }",
      ".shell { max-width: 960px; margin: 0 auto; padding: 28px 20px; }",
      ".hero { padding-top: 52px; }",
      ".eyebrow { letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; color: var(--accent); }",
      "h1 { font-size: clamp(2.4rem, 7vw, 4.6rem); line-height: 0.95; margin: 0 0 14px; }",
      ".lede { max-width: 58ch; color: var(--soft); }",
      ".stack { display: grid; gap: 18px; padding-bottom: 64px; }",
      ".panel { background: var(--panel); border: 1px solid var(--line); border-radius: 22px; padding: 24px; box-shadow: 0 12px 30px rgba(62, 37, 17, 0.08); }",
      ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }",
      ".card { border: 1px solid var(--line); border-radius: 18px; padding: 18px; background: rgba(191, 95, 47, 0.05); }",
      ".cta { display: inline-block; margin-top: 12px; padding: 12px 18px; border: 0; border-radius: 999px; background: var(--accent); color: white; text-decoration: none; font: inherit; cursor: pointer; }",
      ".contact-text { color: var(--soft); min-height: 22px; }",
      "",
    ].join("\n"),
    "script.js": [
      "const button = document.getElementById('contactButton');",
      "const target = document.getElementById('contactText');",
      "",
      "if (button && target) {",
      "  button.addEventListener('click', () => {",
      "    target.textContent = 'hello@portfolio.dev';",
      "  });",
      "}",
      "",
    ].join("\n"),
  };
}

function calculatorWebsiteFiles() {
  return {
    "index.html": [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Calculator Webpage</title>",
      '  <link rel="stylesheet" href="style.css" />',
      "</head>",
      "<body>",
      '  <main class="shell">',
      "    <h1>Calculator</h1>",
      '    <section class="calculator">',
      '      <div id="display" class="display">0</div>',
      '      <div class="keys">',
      '        <button data-action="clear">C</button>',
      '        <button data-value="(">(</button>',
      '        <button data-value=")">)</button>',
      '        <button data-value="/">/</button>',
      '        <button data-value="7">7</button>',
      '        <button data-value="8">8</button>',
      '        <button data-value="9">9</button>',
      '        <button data-value="*">*</button>',
      '        <button data-value="4">4</button>',
      '        <button data-value="5">5</button>',
      '        <button data-value="6">6</button>',
      '        <button data-value="-">-</button>',
      '        <button data-value="1">1</button>',
      '        <button data-value="2">2</button>',
      '        <button data-value="3">3</button>',
      '        <button data-value="+">+</button>',
      '        <button data-value="0" class="wide">0</button>',
      '        <button data-value=".">.</button>',
      '        <button data-action="equals" class="accent">=</button>',
      "      </div>",
      "    </section>",
      "  </main>",
      '  <script src="script.js"></script>',
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "style.css": [
      ":root { --bg: #f4efe6; --panel: #fffdf8; --ink: #1f1a17; --accent: #bf5f2f; --line: #d8c9b5; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top, #fff5dd, var(--bg)); font-family: Georgia, 'Times New Roman', serif; color: var(--ink); }",
      ".shell { width: min(100%, 420px); padding: 20px; }",
      ".calculator { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; padding: 18px; box-shadow: 0 16px 34px rgba(62, 37, 17, 0.08); }",
      ".display { min-height: 74px; display: flex; align-items: center; justify-content: flex-end; padding: 14px; border-radius: 16px; background: #f9f3ea; border: 1px solid var(--line); font-size: 2rem; overflow: hidden; }",
      ".keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }",
      "button { border: 0; border-radius: 16px; padding: 16px; font: inherit; font-size: 1.1rem; cursor: pointer; background: #f0e4d6; color: var(--ink); }",
      "button.wide { grid-column: span 2; }",
      "button.accent { background: var(--accent); color: white; }",
      "",
    ].join("\n"),
    "script.js": [
      "const display = document.getElementById('display');",
      "const keys = document.querySelector('.keys');",
      "let expression = '0';",
      "",
      "function render() {",
      "  display.textContent = expression || '0';",
      "}",
      "",
      "function evaluateExpression() {",
      "  try {",
      "    const result = Function(`return (${expression})`)();",
      "    expression = String(result);",
      "  } catch {",
      "    expression = 'Error';",
      "  }",
      "  render();",
      "}",
      "",
      "keys.addEventListener('click', (event) => {",
      "  const button = event.target.closest('button');",
      "  if (!button) return;",
      "  const action = button.dataset.action;",
      "  const value = button.dataset.value;",
      "  if (action === 'clear') { expression = '0'; render(); return; }",
      "  if (action === 'equals') { evaluateExpression(); return; }",
      "  expression = expression === '0' || expression === 'Error' ? value : expression + value;",
      "  render();",
      "});",
      "",
      "render();",
      "",
    ].join("\n"),
  };
}

function landingPageFiles() {
  return {
    "index.html": [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Landing Page</title>",
      '  <link rel="stylesheet" href="style.css" />',
      "</head>",
      "<body>",
      '  <main class="shell">',
      '    <section class="hero">',
      '      <p class="eyebrow">Launch Faster</p>',
      "      <h1>Turn your next idea into a polished page.</h1>",
      "      <p>A clean landing page starter with hero content, feature cards, proof points, and a strong call to action.</p>",
      '      <a class="cta" href="#contact">Start now</a>',
      "    </section>",
      '    <section class="panel grid">',
      '      <article class="card"><h2>Fast</h2><p>Built to communicate value quickly.</p></article>',
      '      <article class="card"><h2>Focused</h2><p>Simple sections that are easy to customize.</p></article>',
      '      <article class="card"><h2>Trusted</h2><p>Designed to feel clear and credible.</p></article>',
      "    </section>",
      '    <section class="panel stats"><div><strong>10x</strong><span>Faster drafts</span></div><div><strong>24/7</strong><span>Visible workflow</span></div><div><strong>Local</strong><span>Safe factory workspace</span></div></section>',
      '    <section id="contact" class="panel"><h2>Ready to launch?</h2><p id="contactMessage">Click below to reveal the call to action.</p><button id="contactButton" class="cta" type="button">Show CTA</button></section>',
      "  </main>",
      '  <script src="script.js"></script>',
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "style.css": [
      ":root { --bg: #f4efe6; --panel: #fffdf8; --ink: #1f1a17; --accent: #bf5f2f; --line: #d8c9b5; --soft: #7b5e45; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background: radial-gradient(circle at top, #fff5dd, var(--bg)); }",
      ".shell { max-width: 1024px; margin: 0 auto; padding: 48px 20px 72px; display: grid; gap: 18px; }",
      ".hero, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; padding: 28px; box-shadow: 0 14px 30px rgba(62, 37, 17, 0.08); }",
      ".eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--accent); }",
      "h1 { margin: 0 0 12px; font-size: clamp(2.6rem, 7vw, 4.8rem); line-height: 0.95; }",
      ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }",
      ".card { padding: 18px; border-radius: 18px; border: 1px solid var(--line); background: rgba(191, 95, 47, 0.05); }",
      ".stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; }",
      ".stats strong { display: block; font-size: 2rem; }",
      ".stats span { color: var(--soft); }",
      ".cta { display: inline-block; margin-top: 14px; padding: 12px 18px; border: 0; border-radius: 999px; background: var(--accent); color: white; text-decoration: none; font: inherit; cursor: pointer; }",
      "@media (max-width: 720px) { .stats { grid-template-columns: 1fr; } }",
      "",
    ].join("\n"),
    "script.js": [
      "const button = document.getElementById('contactButton');",
      "const message = document.getElementById('contactMessage');",
      "",
      "if (button && message) {",
      "  button.addEventListener('click', () => {",
      "    message.textContent = 'Your landing page is live and ready for customization.';",
      "  });",
      "}",
      "",
    ].join("\n"),
  };
}

function fallbackWebsiteFiles(profile) {
  if (!profile) {
    return null;
  }

  if (profile.type === "todo") return todoWebsiteFiles();
  if (profile.type === "calculator") return calculatorWebsiteFiles();
  if (profile.type === "portfolio") return portfolioWebsiteFiles();
  if (profile.type === "landing") return landingPageFiles();
  return simpleWebsiteFiles();
}

function createSafeFallbackPlan(taskText) {
  const profile = inferWebsiteTaskProfile(taskText);
  if (!profile) {
    return null;
  }

  const files = fallbackWebsiteFiles(profile);
  const slug = slugifyProjectName(profile.projectName);
  const steps = [
    {
      id: `fallback-${slug}-project`,
      tool: "project-create",
      input: { name: profile.projectName },
    },
  ];

  let index = 0;
  for (const [filePath, content] of Object.entries(files)) {
    index += 1;
    steps.push({
      id: `fallback-${slug}-file-${index}`,
      tool: "file-create",
      input: { path: filePath, content },
    });
  }

  return { steps };
}

function sanitizeJsonLikeText(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function removeTrailingCommas(text) {
  return String(text || "").replace(/,\s*([}\]])/g, "$1");
}

function normalizeParsedPlan(parsed) {
  if (Array.isArray(parsed)) {
    return { steps: parsed };
  }

  if (parsed && Array.isArray(parsed.steps)) {
    return { steps: parsed.steps };
  }

  if (parsed?.plan && Array.isArray(parsed.plan.steps)) {
    return { steps: parsed.plan.steps };
  }

  if (parsed?.data && Array.isArray(parsed.data.steps)) {
    return { steps: parsed.data.steps };
  }

  throw new Error('Planner JSON must contain a "steps" array');
}

function validatePlanShape(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    throw new Error('Planner JSON must contain a "steps" array');
  }

  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== "object") {
      throw new Error(`Planner step ${index + 1} must be an object`);
    }

    if (!step.tool || typeof step.tool !== "string") {
      throw new Error(`Planner step ${index + 1} is missing a tool`);
    }

    if (step.input != null && typeof step.input !== "object") {
      throw new Error(`Planner step ${index + 1} input must be an object`);
    }
  }

  return plan;
}

function parsePlanJson(rawText) {
  const raw = sanitizeJsonLikeText(rawText).trim();
  if (!raw) {
    throw new Error("Planner returned empty response");
  }

  const candidates = new Set([raw]);

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    candidates.add(fencedMatch[1].trim());
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(raw.slice(firstBrace, lastBrace + 1).trim());
  }

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.add(raw.slice(firstBracket, lastBracket + 1).trim());
  }

  let lastError = null;
  for (const candidate of candidates) {
    const attempts = [
      candidate,
      candidate.replace(/^json\s*/i, "").trim(),
      removeTrailingCommas(candidate),
      removeTrailingCommas(candidate.replace(/^json\s*/i, "").trim()),
    ];

    for (const attempt of attempts) {
      if (!attempt) {
        continue;
      }

      try {
        const parsed = JSON.parse(attempt);
        return validatePlanShape(normalizeParsedPlan(parsed));
      } catch (error) {
        lastError = error;
      }
    }
  }

  const preview = raw.slice(0, 160).replace(/\s+/g, " ");
  if (lastError) {
    try {
      lastError.message = `${lastError.message}. Response preview: ${preview}`;
    } catch {}
    throw lastError;
  }

  throw new Error(`Planner response was not valid JSON. Response preview: ${preview}`);
}

function formatPlanningError(error) {
  const message = String(error?.message || "Planner response was not valid JSON");

  if (
    /Planner JSON must contain a "steps" array/i.test(message) ||
    /Unexpected token/i.test(message) ||
    /Planner response was not valid JSON/i.test(message)
  ) {
    return "The Ollama model returned a plan LittleCoder could not understand. Try again, or switch to a coding-focused Ollama model in setup.";
  }

  if (/timeout/i.test(message)) {
    return "LittleCoder timed out while waiting for the local model. Make sure Ollama is running and try again.";
  }

  if (/Could not reach|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return "LittleCoder could not reach Ollama. Check that Ollama is running and the configured URL is correct.";
  }

  return `Brain planning failed: ${message}`;
}

function plannerFailureCode(error) {
  const message = String(error?.message || "");

  if (
    /Planner JSON must contain a "steps" array/i.test(message) ||
    /Unexpected token/i.test(message) ||
    /Planner response was not valid JSON/i.test(message)
  ) {
    return "PLANNER_OUTPUT_INVALID";
  }

  if (/timeout/i.test(message)) {
    return "PLANNER_TIMEOUT";
  }

  if (/Could not reach|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return "PLANNER_UNAVAILABLE";
  }

  return "PLANNER_FAILURE";
}

function modelSwitchSuggestion() {
  return "Suggested fix: switch to a coding-focused Ollama model like qwen2.5-coder, deepseek-coder, or codellama in setup.";
}

async function createPlan(taskInput, memory) {
  if (typeof taskInput === "object" && taskInput && Array.isArray(taskInput.steps)) {
    return taskInput;
  }

  const taskText = String(taskInput || "").trim();
  if (!taskText) {
    throw new FatalTaskError("Task input is empty");
  }

  try {
    const parsed = JSON.parse(taskText);
    return validatePlanShape(normalizeParsedPlan(parsed));
  } catch {}

  if (!config.brain.enabled) {
    throw new FatalTaskError("Brain disabled and task was not valid JSON plan");
  }

  try {
    const response = await axios.post(
      ollamaGenerateUrl(config.brain.url),
      {
        model: config.brain.model,
        prompt: buildPlannerPrompt(taskText, memory),
        stream: false,
      },
      { timeout: config.brain.timeoutMs }
    );

    const raw = String(response?.data?.response || "").trim();
    try {
      return parsePlanJson(raw);
    } catch (parseError) {
      const fallbackPlan = createSafeFallbackPlan(taskText);
      if (fallbackPlan) {
        studioEvents.emit("chat.message", {
          id: crypto.randomUUID(),
          role: "worker",
          channel: "studio",
          text: "Planner output was unusable, so LittleCoder switched to a safe built-in website fallback for this task.",
          status: "done",
        });
        return fallbackPlan;
      }

      throw new RetryableTaskError(formatPlanningError(parseError), {
        code: plannerFailureCode(parseError),
      });
    }
  } catch (error) {
    const fallbackPlan = createSafeFallbackPlan(taskText);
    if (fallbackPlan) {
      studioEvents.emit("chat.message", {
        id: crypto.randomUUID(),
        role: "worker",
        channel: "studio",
        text: "The local planner was slow or unavailable, so LittleCoder switched to a safe built-in website fallback for this task.",
        status: "done",
      });
      return fallbackPlan;
    }

    if (error instanceof TaskError) {
      throw error;
    }

    throw new RetryableTaskError(formatPlanningError(error), {
      code: plannerFailureCode(error),
    });
  }
}

class AgentEngine {
  constructor() {
    this.queue = new TaskQueue();
    this.stateStore = new TaskStateStore(config.paths.taskState);
    this.stateStore.recoverInterruptedTasks();
    this.executionAdapter = new ExecutionAdapter();
    this.memory = {
      currentProject: null,
      lastTaskId: null,
      planningFailureStreak: 0,
      conversation: [],
    };
  }

  createTask(input, source = "system") {
    const timestamp = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      input,
      source,
      status: TASK_STATES.PENDING,
      attempts: 0,
      maxRetries: config.worker.maxRetries,
      error: null,
      resultSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  updateTask(task, patch) {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    this.stateStore.upsert(task);
  }

  emitTask(eventName, payload) {
    studioEvents.emit(eventName, payload);
  }

  async submit(input, context = {}) {
    const task = this.createTask(input, context.source || "external");
    this.updateTask(task, {});

    return this.queue.enqueue(async () => {
      return this.runTask(task, context);
    });
  }

  isRetryable(error) {
    if (error instanceof TaskError) {
      return error.retryable;
    }

    return false;
  }

  handlePlanningFailure(error, canRetry) {
    const planningFailure = String(error.code || "").startsWith("PLANNER_");
    if (!planningFailure) {
      return;
    }

    this.memory.planningFailureStreak += 1;

    if (!canRetry && this.memory.planningFailureStreak >= 2) {
      error.message = `${error.message} ${modelSwitchSuggestion()}`;
    }
  }

  async resolveMode(taskInput, context = {}) {
    const requestedMode = normalizeInteractionMode(context.mode);
    if (requestedMode === "chat" || requestedMode === "build") {
      return {
        requestedMode,
        resolvedMode: requestedMode,
      };
    }

    return {
      requestedMode: "auto",
      resolvedMode: await decideAutoMode(taskInput, this.memory),
    };
  }

  async finishWithoutExecution(task, output, modeState) {
    this.memory.lastTaskId = task.id;
    this.updateTask(task, {
      status: TASK_STATES.SUCCEEDED,
      resultSummary: String(output || "").slice(0, 1000),
      error: null,
    });
    rememberConversation(this.memory, "worker", output, {
      mode: modeState.resolvedMode,
    });

    this.emitTask("task.done", {
      taskId: task.id,
      output,
      activeProject: this.memory.currentProject,
      requestedMode: modeState.requestedMode,
      resolvedMode: modeState.resolvedMode,
    });

    return {
      taskId: task.id,
      status: TASK_STATES.SUCCEEDED,
      attempts: task.attempts,
      output,
      plan: null,
      activeProject: this.memory.currentProject,
      requestedMode: modeState.requestedMode,
      resolvedMode: modeState.resolvedMode,
    };
  }

  async runChatTask(task, modeState) {
    task.attempts += 1;
    this.updateTask(task, {
      status: TASK_STATES.PLANNING,
      error: null,
    });

    const output = await createChatReply(task.input, this.memory);
    this.memory.planningFailureStreak = 0;
    return this.finishWithoutExecution(task, output, modeState);
  }

  async runBuildTask(task, context, modeState) {
    const contextualReply = createContextualFollowUpReply(task.input, this.memory, modeState.resolvedMode);
    if (contextualReply) {
      return this.finishWithoutExecution(task, contextualReply.message, modeState);
    }

    const quickReply = createQuickReply(task.input, modeState.resolvedMode);
    if (quickReply) {
      return this.finishWithoutExecution(task, quickReply.message, modeState);
    }

    while (task.attempts <= task.maxRetries) {
      try {
        task.attempts += 1;
        this.updateTask(task, { status: TASK_STATES.PLANNING, error: null });

        const plan = await createPlan(task.input, this.memory);
        this.updateTask(task, { status: TASK_STATES.EXECUTING });

        const execution = await this.executionAdapter.executePlan(
          plan,
          {
            taskId: task.id,
            activeProject: context.projectName || this.memory.currentProject,
            source: context.source || task.source,
          },
          config.executionMode
        );

        this.memory.currentProject =
          execution.context.activeProject || this.memory.currentProject;
        this.memory.lastTaskId = task.id;
        this.memory.planningFailureStreak = 0;
        rememberConversation(this.memory, "worker", execution.output || "Task completed.", {
          mode: modeState.resolvedMode,
        });

        this.updateTask(task, {
          status: TASK_STATES.SUCCEEDED,
          resultSummary: String(execution.output || "").slice(0, 1000),
        });

        this.emitTask("task.done", {
          taskId: task.id,
          output: execution.output || "",
          activeProject: this.memory.currentProject,
          requestedMode: modeState.requestedMode,
          resolvedMode: modeState.resolvedMode,
        });

        return {
          taskId: task.id,
          status: task.status,
          attempts: task.attempts,
          output: execution.output || "",
          plan,
          activeProject: this.memory.currentProject,
          requestedMode: modeState.requestedMode,
          resolvedMode: modeState.resolvedMode,
        };
      } catch (error) {
        const retryable = this.isRetryable(error);
        const canRetry = retryable && task.attempts <= task.maxRetries;

        this.handlePlanningFailure(error, canRetry);

        this.updateTask(task, {
          status: canRetry ? TASK_STATES.RETRYING : TASK_STATES.FAILED,
          error: error.message,
        });

        if (!canRetry) {
          rememberConversation(this.memory, "worker", error.message, {
            mode: modeState.resolvedMode,
          });
          this.emitTask("task.error", {
            taskId: task.id,
            error: error.message,
            requestedMode: modeState.requestedMode,
            resolvedMode: modeState.resolvedMode,
          });
          throw error;
        }

        await delay(config.worker.retryDelayMs);
      }
    }

    throw new FatalTaskError("Task exhausted retries");
  }

  async runTask(task, context) {
    const modeState = await this.resolveMode(task.input, context);
    rememberConversation(this.memory, "user", task.input, {
      mode: modeState.requestedMode,
      source: context.source || task.source,
    });
    this.emitTask("task.start", {
      taskId: task.id,
      input: typeof task.input === "string" ? task.input : JSON.stringify(task.input),
      source: task.source,
      requestedMode: modeState.requestedMode,
      resolvedMode: modeState.resolvedMode,
    });

    if (modeState.resolvedMode === "chat") {
      return this.runChatTask(task, modeState);
    }

    return this.runBuildTask(task, context, modeState);
  }
}

module.exports = AgentEngine;

