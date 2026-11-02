const protectedTerm = String.raw`(?:merge|fusion(?:ar|es)?|desplieg(?:ues?|ar)|deploy|producci[oó]n|production|railway|dns|secretos?|secrets?|credenciales?|credentials?|claves?\s+api|api\s+keys?|base\s+de\s+datos|database|gasto|spend|facturaci[oó]n|billing|l[ií]mites?(?:\s+de\s+(?:gasto|pago))?|paid\s+limits?)`;

const protectedActionNegation = new RegExp(
  String.raw`\b(?:no|nunca|do not|don't|never)\s+(?:(?:hagas?|hacer|toques?|tocar|touch|perform|modifi(?:ques?|car)|modify|cambi(?:es?|ar)|change|desplieg(?:ues?|ar)|deploy|aument(?:es?|ar)|increase)\s+)?` +
    protectedTerm +
    String.raw`(?:\s*(?:,|y|e|o|ni|and|or|nor)\s*(?:` + protectedTerm + String.raw`))*\b[^.;\n]*`,
  "gi",
);

export function actionablePolicyText(task: string) {
  // Remove only clearly negated protected-action clauses for the approval gate.
  // This includes compound prohibitions such as
  // "No tocar producción, Railway, DNS, secretos, base de datos ni límites de gasto."
  // and "Do not touch production, Railway, DNS, secrets, database, billing or paid limits."
  // Preserve ordinary negative requirements such as "no omitas gráficos" so the
  // coordinator still receives them as generation/audit invariants.
  return task.replace(protectedActionNegation, " ");
}
