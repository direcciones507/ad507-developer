import assert from "node:assert/strict";
import test from "node:test";
import { actionablePolicyText } from "./actionable-policy-text.js";
import { classifyTask } from "./policy.js";

test("Spanish prohibitions are not treated as requested actions", () => {
  const mission = "Audita documentos. No hagas acciones protegidas. Revisa los renderers.";
  assert.equal(classifyTask(actionablePolicyText(mission)).approvalRequired, false);
});

test("English prohibitions are not treated as requested actions", () => {
  const mission = "Audit documents. Do not perform protected operations. Review the renderers.";
  assert.equal(classifyTask(actionablePolicyText(mission)).approvalRequired, false);
});

test("non-negated text remains available to policy classification", () => {
  const mission = "Revisa una regresión crítica de autenticación. No hagas cambios fuera del alcance.";
  assert.equal(classifyTask(actionablePolicyText(mission)).route, "specialist");
});


test("compound Spanish protected-action prohibitions do not require approval", () => {
  const mission =
    "Auditar solamente. No tocar producción, Railway, DNS, secretos, base de datos ni límites de gasto. No hacer cambios.";
  assert.equal(classifyTask(actionablePolicyText(mission)).approvalRequired, false);
});

test("compound English protected-action prohibitions do not require approval", () => {
  const mission =
    "Audit only. Do not touch production, Railway, DNS, secrets, database, billing or paid limits. Do not make changes.";
  assert.equal(classifyTask(actionablePolicyText(mission)).approvalRequired, false);
});

test("affirmative protected actions still require approval", () => {
  assert.equal(classifyTask(actionablePolicyText("Modificar DNS de producción.")).approvalRequired, true);
  assert.equal(classifyTask(actionablePolicyText("Cambiar secreto de producción.")).approvalRequired, true);
  assert.equal(classifyTask(actionablePolicyText("Aumentar gasto de producción.")).approvalRequired, true);
});
