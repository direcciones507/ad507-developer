// The CLI now queues work in the same durable runtime as the web panel.
// It must not bypass project isolation, budget accounting or human approval.
if (!process.env.AD507_PROJECT) throw new Error("Select AD507_PROJECT explicitly.");
const task = process.argv.slice(2).join(" ").trim();
if (!task) throw new Error("Provide a task as the command argument.");
const origin = process.env.AD507_ORIGIN ?? "http://127.0.0.1:8787";
const url = new URL(origin);
if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("HTTPS_REQUIRED");
const password = process.env.AD507_PANEL_PASSWORD;
if (!password) throw new Error("AD507_PANEL_PASSWORD is required for the private queue API.");
const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password }) });
if (!login.ok) throw new Error("Panel authentication failed.");
const { csrf } = await login.json() as { csrf: string };
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Missing authenticated session.");
const response = await fetch(`${origin}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CSRF-Token": csrf },
  body: JSON.stringify({ project: process.env.AD507_PROJECT, instructions: task }) });
if (!response.ok) throw new Error(`Queue rejected task: HTTP ${response.status}`);
const result = await response.json() as { id: string; state: string };
console.log(JSON.stringify({ id: result.id, state: result.state, panel: origin }));
export {};
