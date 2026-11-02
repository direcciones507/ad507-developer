# AD507 Developer — operación y evidencia

> Actualización: [RAILWAY_ACTIONS.md](RAILWAY_ACTIONS.md) describe la arquitectura vigente con checks remotos en GitHub Actions. Los requisitos de host Docker local y pruebas pendientes de este informe corresponden al punto de partida anterior.

2026-10-19. Continúa PR #358 (documental). **Implementado y probado localmente; no desplegado ni verificado con inferencia real.**

## Un solo agente y alcance

Se amplía `tools/ad507-agent`: se conservan paquete, `policy.ts`, `actionable-policy-text.ts`, registro y capacidades de archivos/ramas/checks/PR. Las herramientas del antiguo SDK se migran a `runtime/workspace.mjs` y `publisher.mjs` para que todo pase por persistencia, aislamiento y presupuesto. `src/agents.ts` conserva el contrato del coordinador. CLI y panel usan la misma cola; no hay runner SDK paralelo ni escalación pagada automática.

Se consultaron el checklist integral y #358. No cambian `apps/api`, `apps/web`, producción, router ni datos de LEVEIA. SECONDARY, UNIVERSITY, UNIVERSITY_PRO y PERSONAL: sin impacto de comportamiento o permisos.

## Persistencia

Node 24: HTTP + worker serial, mantenido por supervisor/systemd. Cerrar ChatGPT, navegador, sesión o tablet no detiene las tareas del servidor.

SQLite WAL + synchronous=FULL guarda tareas, mensajes, pasos, auditoría, aprobaciones, tokens, reservas y sesiones. Workspaces y SQLite requieren volumen persistente dedicado. Se elige SQLite frente al PostgreSQL del plan documental para este MVP de un propietario/un worker: evita tocar bases productivas o contratar otra DB. Escalar horizontalmente requiere migración explícita.

Un SQLite separado mantiene transacción exclusiva como candado de líder: se libera al morir el proceso y evita fallos por PID reutilizado. Una réplica, un volumen local, un host; no NFS ni réplicas compartiendo volumen.

Estados: pendiente, ejecutando, pausado, esperando aprobación, completado, fallido, cancelado. Una interrupción activa pasa a revisión de recuperación. El checkpoint se guarda antes de herramientas/llamadas externas. No se repiten escrituras inciertas automáticamente: el propietario inspecciona y autoriza continuar con nueva inspección. Inicialización Git interrumpida: conservar para revisión y crear otra tarea. Pausar entre pasos permite reanudar; abortar una llamada activa conserva reserva y exige revisión. Cancelar una publicación recibida por GitHub no la revierte: se conserva evidencia y enlace. No se hace merge/deploy.

## Proyectos y herramientas

- Junta Comunal de Santiago: Git local separado por tarea, sin repo remoto, solo `docs/`. No construir web, comprar dominio ni tocar DNS.
- LEVEIA: repo exacto `direcciones507/leveia`; clone independiente de `main` de un source local autorizado, sin hardlinks/worktrees compartidos, eliminando remote y usando `ad507/task-<uuid>`.

El panel selecciona registros autorizados; no habilita repositorios arbitrarios. El source se aprovisiona por operador, con origin exacto `https://github.com/direcciones507/leveia.git` y sin token en URL/config, mediante `AD507_LEVEIA_SOURCE`. Su actualización respecto a GitHub debe verificarse antes de cada misión.

Herramientas: listar, leer, escribir, reemplazo literal único, inspección de cambios y checks permitidos. Rechazan escapes, symlinks, hardlinks, `.git`, `.env`, claves y credenciales. Escritura de workflows, manifests de dependencias y otros archivos de control bloqueada: requiere intervención revisada del operador. No hay shell general, borrado, DNS, SQL, secretos o administración de infraestructura.

## Sandbox

Checks requieren Docker en host dedicado. Sin Docker: detener; nunca ejecutar comandos del repo en el host. Cada check recibe snapshot sin `.git`, secretos, `.env` o enlaces; fuente y raíz readonly; usuario no root; red desactivada; sin capabilities; no-new-privileges; 1 CPU, 512 MB, 64 procesos, tmpfs limitado y 120 segundos. La imagen debe existir localmente (--pull=never). Un timeout interno del contenedor mantiene el límite aunque muera el controlador. No recibe env del controlador ni socket Docker.

`deploy/checks.Dockerfile` precarga dependencias desde snapshot/lockfile revisados; en ejecución se copia plantilla + snapshot a tmpfs, sin instalar desde Internet. Su imagen **no se ha construido aquí**. Builds grandes pueden requerir revisar límites; no se elevan solos. La salida es acotada/redactada y permite corregir fallos. Una nueva escritura invalida evidencia anterior: se exige check pasado de la revisión actual para entregar código real. Docs/simulación informan la ausencia de checks de producto.

## Acceso y presupuesto

Propietario: scrypt, cookies HttpOnly/SameSite=Strict/Secure con HTTPS, sesiones 12 h, CSRF, Origin/Host, rate limit, CSP, textContent y API protegida. HTTP solo loopback. No contraseña predeterminada. Secretos no se exponen en status ni al modelo.

Generar hash sin password en argumentos o Git: `node runtime/hash-password.mjs < /ruta/privada/entrada-de-password`. Usar gestor de contraseñas y eliminar entrada temporal; configurar hash únicamente en entorno dedicado.

DeepSeek predeterminado; OpenAI solo por selección explícita. No fallback automático. Requiere live=true, key, modelo y tarifas positivas antes de llamar. DeepSeek Chat Completions con thinking desactivado; OpenAI max_completion_tokens. Modelo definitivo se confirma al conectar; no asumir IDs antiguos. Documentación oficial consultada: https://api-docs.deepseek.com/api/create-chat-completion/ . No se autenticó contra proveedor real.

Antes de cada petición se reserva techo conservador con bytes UTF-8 + margen + máximo de salida, a tarifas configuradas en micro-USD/token. Usar tarifas >= vigentes, sin descontar caché. No reembolsar automáticamente llamadas interrumpidas. Se registran tokens declarados; reserva no equivale a factura. Límites iniciales: $0.25/tarea, $1/proyecto acumulado, 40 pasos, 30 minutos activos y contexto acotado; sin recargas automáticas. Simulación usa unidades simbólicas sin gasto externo; datos separados de reales.

## Entregas y PR

El propietario revisa y aprueba o rechaza. Junta/simulación completan localmente. LEVEIA prepara PR en borrador solo con `AD507_PUBLISH_ENABLED=true` y token fino exclusivo del repo (contents + PR, sin administración). El publicador fija repo/base/prefijo, crea Git trees/commit/ref por REST, nunca mueve refs existentes ni main. Reintenta buscando PR/árbol de la misma rama; conflictos o PR cerrado requieren revisión. No hay API para merge/deploy/secretos, incluso ante aprobación genérica.

## Arranque y despliegue

Desde `tools/ad507-agent`: `node runtime/main.mjs`. Configurar `.env.example` en gestor de entorno dedicado, sin copiar variables productivas. Simulación: AD507_PROVIDER=simulation, hash y volumen nuevos. CLI encola con AD507_ORIGIN/AD507_PANEL_PASSWORD.

Dockerfile + railway.toml preparan **solo controlador**; seleccionar config explícitamente en servicio NUEVO, una réplica, `/data` persistente, HTTPS y hash. No enlazado a ningún servicio existente. Railway controlador por sí solo no proporciona daemon Docker. El código actual usa daemon local, no worker remoto: requiere host Docker dedicado para checks reales. Alternativa preparada: `deploy/ad507-developer.service`, host dedicado + volumen + reverse proxy HTTPS. El usuario ad507 necesita acceso al daemon; ese host no debe alojar otros proyectos/secretos. No otorgar acceso al daemon del servidor productivo de LEVEIA.

Railway inspeccionado: leveia-staging (1b44bc7e-db12-4ea6-9955-70c4ce68aed3) y meticulous-elegance (15f9e925-f507-4636-8820-be92d337e021), API/Web/Postgres existentes, sin worker AD507 dedicado. Sin recursos creados ni variables modificadas. **No hay URL de panel desplegado.**

## Evidencia y límites

- Runtime: SQLite real, Git real, API HTTP, proceso servidor independiente, SIGKILL/reinicio, pausas y cancelaciones reales.
- Adaptadores DeepSeek/OpenAI: pruebas con respuestas simuladas; credencial real pendiente.
- Publicador: contrato REST simulado, incluyendo recuperación sin PR duplicado; emisión real por el ejecutor pendiente de token. El PR de esta implementación se crea con la conexión GitHub del propietario, no se presenta como prueba del publicador runtime.
- Docker: flags, snapshot y fail-closed probados con ejecutor simulado; ningún contenedor de código real ejecutado aquí.
- Panel: Chromium en 390x844, 768x1024, 1024x768; creación → archivo → aprobación → logout; sin overflow horizontal ni errores JS. Tablet física pendiente.
- Pruebas y capturas reproducibles en workflow AD507 Technology Agent CI. CI verde no equivale a operación real.

## Coste y pendientes

Gasto nuevo: **$0 de infraestructura/inferencia**; no contratado ni desplegado.

Estimación ilustrativa controlador: 0.25 GB RAM + 0.05 vCPU continuos + 1 GB volumen ≈ $3.65/mes a tarifas publicadas ($10/GB RAM-mes, $20/vCPU-mes, $0.15/GB volumen-mes), antes de transferencia/inferencia. No medido ni cotizado, no confirma créditos del plan actual y **no incluye host Docker**. Fuente: https://docs.railway.com/platform/compare-to-heroku . El host requiere elegir proveedor/capacidad y autorizar coste antes de contratar.

Pasos mínimos para primera ejecución real:

1. Autorizar/elegir host dedicado con Docker, volumen, HTTPS y hash; construir/verificar imagen/checks reales.
2. Aprovisionar source LEVEIA y token fino si se requiere PR real. Junta permanece en preparación.
3. Cuando el propietario entregue DeepSeek por secreto, confirmar modelo/tarifas, habilitar una prueba mínima y comprobar consumo.
4. Verificar misión real, pruebas, PR y acceso en tablet física.

La credencial por sí sola no basta para declarar operativo: faltan host, sandbox y acceso privado verificados.
