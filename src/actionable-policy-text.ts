const protectedTerm = String.raw`(?:merge|fusion(?:ar|es)?|desplieg(?:ues?|ar)|deploy|producci[oó]n|production|railway|dns|secretos?|secrets?|credenciales?|credentials?|claves?\s+api|api\s+keys?|base\s+de\s+datos|database|gasto|spend|facturaci[oó]n|billing|l[ií]mites?(?:\s+de\s+(?:gasto|pago))?|paid\s+limits?)`;

const protectedActionNegation = new RegExp(
  String.raw`\b(?:no|nunca|do not|don't|never)\s+(?:(?:hagas?|hacer|toques?|tocar|touch|perform|modifi(?:ques?|car)|modify|cambi(?:es?|ar)|change|publi(?:ques?|car)|publish|fusion(?:es?|ar)|merge|desplieg(?:ues?|ar)|deploy|aument(?:es?|ar)|increase)\s+)?` +
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
  // A prohibition may begin with an ordinary object before reaching a protected
  // action: "No modificar archivos ni publicar en producción". The old regex
  // only recognized prohibitions directly adjacent to a protected term.
  // Split at sentence boundaries, then discard negative-only clauses for the
  // approval classifier. Preserve positive requests following "pero"/"but".
  return task.split(/([.;\n])/).map(part => {
    if (/^[.;\\n]$/.test(part)) return part;
    const clauses=part.split(/\b(?:pero|but|however)\b/i);
    return clauses.map(clause => {
      const trimmed=clause.trim().replace(/^[-*\d)\s]+/,'');
      if (/^(?:no|nunca|jam[aá]s|do not|don't|never)\b/i.test(trimmed)) return ' ';
      return clause.replace(protectedActionNegation,' ');
    }).join(' ');
  }).join('');
}
