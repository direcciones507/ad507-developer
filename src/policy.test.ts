import assert from "node:assert/strict";
import test from "node:test";
import { actionablePolicyText } from "./actionable-policy-text.ts";
import { classifyTask } from "./policy.ts";

const classifyMission = (task: string) => classifyTask(actionablePolicyText(task));

test("routine repository review stays with coordinator", () => {
  assert.equal(classifyMission("Review a README typo and prepare a small correction").route, "coordinator");
});

test("architecture and security work escalates to specialist", () => {
  assert.equal(classifyMission("Review authentication architecture and security regression").route, "specialist");
});

test("production and merge actions require approval", () => {
  assert.equal(classifyMission("Merge this PR to main and deploy production").approvalRequired, true);
});

test("destructive database action requires approval", () => {
  assert.equal(classifyMission("Drop the production table and recreate it").approvalRequired, true);
});

test("Spanish routine work stays with coordinator", () => {
  assert.equal(classifyMission("Revisa el README y corrige un texto pequeño").route, "coordinator");
});

test("Spanish complex security work escalates", () => {
  assert.equal(classifyMission("Revisa una regresión crítica de autenticación y seguridad").route, "specialist");
});

test("Spanish production and merge actions require approval", () => {
  assert.equal(classifyMission("Fusionar a main y desplegar a producción").approvalRequired, true);
});

test("Spanish prohibitions do not request protected actions", () => {
  const task = "Audita los documentos. No hagas merge, no cambies secretos, no aumentes gasto ni modifiques producción.";
  assert.equal(classifyMission(task).approvalRequired, false);
});

test("English prohibitions do not request protected actions", () => {
  const task = "Audit document generation. Do not merge to main, do not deploy production, and do not change secrets.";
  assert.equal(classifyMission(task).approvalRequired, false);
});

test("a real protected action remains blocked after a negated one", () => {
  const task = "Do not deploy production. Merge this PR to main.";
  assert.equal(classifyMission(task).approvalRequired, true);
});


test("document constraints survive approval-gate negation filtering", () => {
  const task = "Audita PPTX. No omitas gráficos, no alteres columnas y no pierdas imágenes.";
  const filtered = actionablePolicyText(task);
  assert.match(filtered, /No omitas gráficos/i);
  assert.match(filtered, /no alteres columnas/i);
  assert.match(filtered, /no pierdas imágenes/i);
});

test("negated protected actions are removed without erasing later document constraints", () => {
  const task = "No hagas merge. No omitas gráficos. No despliegues producción. Conserva 10 diapositivas.";
  const filtered = actionablePolicyText(task);
  assert.doesNotMatch(filtered, /hagas merge/i);
  assert.doesNotMatch(filtered, /despliegues producción/i);
  assert.match(filtered, /No omitas gráficos/i);
  assert.match(filtered, /Conserva 10 diapositivas/i);
  assert.equal(classifyTask(filtered).approvalRequired, false);
});
