import { classifyTask } from "./policy.ts";

const task = process.argv.slice(2).join(" ").trim();
if (!task) throw new Error("Provide a task as the command argument.");

const decision = classifyTask(task);
console.log(JSON.stringify({
  mode: "dry-run",
  task,
  route: decision.route,
  approvalRequired: decision.approvalRequired,
  apiCalled: false
}, null, 2));
