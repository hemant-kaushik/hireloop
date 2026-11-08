import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, "127.0.0.1", () => {
  console.log(`[api] HireLoop API on http://localhost:${config.port}`);
  console.log(`[api] db: ${config.dbPath}${config.envFileLoaded ? "" : "  (no server/.env, using defaults)"}`);
});
