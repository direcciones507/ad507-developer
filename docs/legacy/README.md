# AD507 Technology Agent / AD507 Developer

Un único agente en `tools/ad507-agent`, con panel privado y cola durable.

Configuración vigente: [MULTIPROJECT_DEEPSEEK.md](MULTIPROJECT_DEEPSEEK.md).

Consultar [RAILWAY_ACTIONS.md](RAILWAY_ACTIONS.md) (arquitectura vigente) y [OPERATIONS.md](OPERATIONS.md) (punto de partida) para arquitectura, controles, evidencia, despliegue, costes y bloqueos.

- Junta Comunal: preparación/documentación, sin construir la web.
- LEVEIA: repositorio autorizado y ramas aisladas, sin producción.
- DeepSeek exclusivo; sin OpenAI ni fallback. Inferencia deshabilitada hasta autorizar consumo.
- Direcciones 507/LATAM, ReportaPA y Empleos.pa autorizados, con tokens separados. Nuevos proyectos desde el panel, registro durable en SQLite.
- SQLite + volumen + supervisor; CLI y panel en la misma cola.
- Entregables para aprobación humana; sin merge/deploy desde el agente.

PR #358 documentó el punto de partida. La implementación debe verificarse en entorno real antes de declararse operativa.
