export type TaskRoute = "coordinator" | "specialist";

const approvalPatterns = [
  /\bmerge\b.*\bmain\b/i,
  /\bfusionar\b.*\bmain\b/i,
  /\bdeploy\b.*\bproduction\b/i,
  /\b(desplegar|publicar)\b.*\bproducci[oó]n\b/i,
  /\bproduction\b.*\b(config|configuration)\b/i,
  /\bproducci[oó]n\b.*\b(config|configuraci[oó]n)\b/i,
  /\bdns\b/i,
  /\b(drop|truncate|delete)\b.*\b(table|database|production)\b/i,
  /\b(eliminar|borrar|truncar)\b.*\b(tabla|base de datos|producci[oó]n)\b/i,
  /\b(secret|credential|api key)\b/i,
  /\b(secreto|credencial|clave api)\b/i,
  /\b(spend|billing|paid limit)\b/i,
  /\b(gasto|facturaci[oó]n|l[ií]mite de pago)\b/i,
];

const specialistPatterns = [
  /\barchitecture\b/i,
  /\barquitectura\b/i,
  /\bsecurity\b/i,
  /\bseguridad\b/i,
  /\bauth(entication|orization)?\b/i,
  /\bautenticaci[oó]n\b/i,
  /\bautorizaci[oó]n\b/i,
  /\bconcurrency\b/i,
  /\bconcurrencia\b/i,
  /\brace condition\b/i,
  /\bcondici[oó]n de carrera\b/i,
  /\bdata migration\b/i,
  /\bmigraci[oó]n de datos\b/i,
  /\bcritical regression\b/i,
  /\bregresi[oó]n cr[ií]tica\b/i,
  /\bcomplex\b/i,
  /\bcomplej[oa]\b/i,
];

export function classifyTask(task: string) {
  return {
    route: specialistPatterns.some((pattern) => pattern.test(task)) ? "specialist" as const : "coordinator" as const,
    approvalRequired: approvalPatterns.some((pattern) => pattern.test(task)),
  };
}

export const specialistBudget = {
  maxAutomaticEscalationsPerRun: 1,
} as const;
