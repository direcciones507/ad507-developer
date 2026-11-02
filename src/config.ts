// Compatibility metadata for tooling. Runtime validation lives in runtime/config.mjs.
// Provider/model selection is explicit; no automatic paid specialist or fallback.
export const agentConfig = {
  name: "AD507 Developer",
  provider: process.env.AD507_PROVIDER ?? "deepseek",
  model: process.env.AD507_MODEL ?? null,
  project: process.env.AD507_PROJECT ?? "leveia",
  maxTurns: 40,
} as const;
export const approvalRequired = new Set([
  "merge_main", "production_deploy", "production_config_change", "dns_change",
  "destructive_database_operation", "credential_or_secret_change",
  "paid_limit_increase", "extraordinary_spend", "sensitive_access_expansion",
]);
