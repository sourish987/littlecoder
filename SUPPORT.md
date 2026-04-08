# Support

## Getting Started

1. Install Node.js
2. Install Ollama
3. Run `ollama serve`
4. Pull the model:
   `ollama pull qwen2.5-coder:7b-instruct-q4_K_M`
5. Run:
   `npm install`
   `npm run setup`
   `npm start`

## If Setup Does Not Open

- make sure nothing else is using port `3210`
- run `npm run setup` directly

## If Studio Does Not Open

- check the console for the Studio URL
- open that URL manually in your browser

## If Ollama Validation Fails

- make sure Ollama is installed
- make sure `ollama serve` is running
- make sure the selected model is pulled locally

## If You Need More Help

Open a GitHub issue with:
- your OS
- Node version
- what command you ran
- what happened

Please do not include secrets.
