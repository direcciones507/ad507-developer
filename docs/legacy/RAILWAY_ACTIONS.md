# Finalización Railway + GitHub Actions — AD507 Developer

2026-10-19. Continúa el mismo agente y PR #359; no crea un segundo agente ni modifica aplicaciones productivas.

## Infraestructura histórica verificada

Se inventariaron los 8 proyectos accesibles de la cuenta Railway. LEVEIA tiene API/Web/Postgres en meticulous-elegance, leveia-production-dark y leveia-staging; no aparece un servicio activo exclusivo del programador. n8n sigue activo en amused-enchantment y no se modifica. Dos proyectos vacíos no contienen servicios ni volúmenes. El volumen no montado PostgresProd-data pertenece a leveia-production-dark y no se reutiliza por posible contenido productivo.

Se verificaron jobs `manual-mission` exitosos del AD507 Technology Agent en GitHub Actions:

- 2026-09-19: runs 35411934585 y 35416358932.
- 2026-10-04: run 37178365522.

Por tanto, se reutiliza el workflow `.github/workflows/ad507-technology-agent-ci.yml`, ya registrado en main. No es necesario fusionar #359 para ejecutar su versión revisada desde la rama autorizada.

## Arquitectura seleccionada

| Parte | Ubicación |
|---|---|
| Panel HTTPS, sesiones, cola, modelo, presupuestos y publicador | Un servicio pequeño AD507 en la cuenta Railway existente |
| SQLite, auditoría, sesiones, workspaces, mirror y snapshots | Volumen nuevo exclusivo `/data`, sin Postgres del producto |
| Docker y dependencias de checks | Runner temporal de GitHub Actions, solo mientras hay un check |
| Modelos | DeepSeek principal; OpenAI explícito alternativo; keys solo en controlador |
| Proyectos | Junta Comunal: solo preparación/docs; LEVEIA: desarrollo aislado |

El servicio propuesto se ubica en el proyecto existente **leveia-staging**, sin cambiar API/Web/Postgres. Se requieren recurso de cómputo y volumen dedicados, aunque se reutilice la cuenta. Están sujetos a aprobación antes de activarse. No se promete coste cero por tener Pro.

## Protocolo implementado

`ActionsChecks` guarda cada check en SQLite con hash de snapshot, revisión, proveedor de ejecución, reserva de minutos, estado e identidad del run. El ticket HMAC específico del check usa una clave interna generada una vez y guardada con permisos 0600 en el volumen; no requiere que el propietario invente otra clave.

Antes de dispatch se reserva un máximo de 10 minutos por job (timeout del workflow), con topes mensuales/globales, por proyecto y por tarea. El envío se registra antes del HTTP externo. Un timeout incierto nunca se despacha de nuevo automáticamente: exige revisión. Se acepta API 2026-03-10 con run ID y el caso 204 anterior, que se vincula al claim verificado.

GitHub usa una capacidad por job, valida SHA exacto, branch, repositorio, título, evento, run ID e intento 1 antes de descargar el snapshot. El ticket se lee del archivo de evento y se enmascara antes de imprimir; no se pasa en env del step, que GitHub registraría antes del enmascarado. El origen del controlador viene de la variable de repositorio `AD507_CONTROLLER_ORIGIN`, no del prompt ni de un input arbitrario.

Solo se transfieren archivos permitidos del snapshot: sin .git, .env, claves, credenciales, symlinks, hardlinks o node_modules. El runner valida hash, rutas, duplicados, límites de compresión y tamaño antes de escribir en una carpeta temporal independiente. El modelo no proporciona comandos: el check se resuelve contra la allowlist del código confiable del workflow.

La imagen precarga dependencias de la revisión confiable sin scripts de instalación ni claves de inferencia. Se enlazan dependencias readonly para no copiar todo node_modules a tmpfs; los enlaces internos de workspaces apuntan a la revisión modificada, no al baseline. El contenedor corre sin red, capacidades o secretos; raíz y snapshot readonly, UID 1000, RAM/CPU/PID/tmpfs limitados y timeout interno de 120 segundos. La API key/token GitHub/controlador no entran al contenedor.

El runner devuelve un resultado acotado/redactado por HTTPS con el mismo ticket. El resultado se guarda antes de responder y callbacks repetidos son idempotentes. Un callback nunca aprueba la tarea ni modifica su estado de negocio. Solo se incorpora al contexto si corresponde al check y revisión actuales.

Pausa o reinicio: el waiter se separa; el check inmutable puede finalizar y su recibo se reutiliza sin otro dispatch ni reserva. La recuperación del agente conserva la revisión humana de #359. Cancelación: se revoca el ticket, se cancela únicamente el run registrado y se mantiene un registro de cancelaciones pendientes; el timeout del workflow sigue limitando un run cuyo ID aún no se conozca.

## Preparación para Railway

- Dockerfile del controlador sin daemon Docker ni dependencias educativas del runtime.
- Volumen `/data` dedicado. El entrypoint inicia solo `/data/ad507` como node y luego baja a UID 1000; resuelve el mount root de Railway.
- Una réplica, sin sleep mientras se ejecuten tareas, SQLite WAL/candado líder y reinicio por fallo. No NFS ni réplicas compartidas.
- HTTPS mediante dominio de servicio Railway, sin comprar dominio ni modificar DNS.
- Fuente fijada al commit revisado en `ad507/task-developer-runtime`; no main de producto.
- Bootstrap Git read-only de LEVEIA main con token solo en entorno del proceso Git; no en argumentos, URL, configuración ni checkout del modelo. Nunca push del mirror.

No existe contraseña predeterminada ni se inventan tokens. Faltan al menos:

1. Hash scrypt del propietario para el panel y origen HTTPS asignado después de crear el dominio.
2. Token fino exclusivo de `direcciones507/leveia`: Contents read y Actions write para source/runner. Si se usa el publicador: Contents write + Pull requests write. Puede ser un token por rol o uno restringido al único repo; no administración.
3. Variable GitHub `AD507_CONTROLLER_ORIGIN` con el HTTPS real, y SHA/ref revisados alineados con el controlador.
4. DeepSeek por secreto del servicio para inferencia real. OpenAI solo si se configura explícitamente.
5. Confirmación de minutos incluidos disponibles y límite de gasto GitHub que detenga sobrecostos.

`AD507_ACTIONS_INCLUDED_ONLY_CONFIRMED=false` y `AD507_ACTIONS_MONTHLY_MINUTES=0` por defecto: el controlador no envía jobs hasta confirmar ambos. Sus reservas cuentan únicamente sus checks; el resto del CI del repositorio también consume minutos. La barrera real contra sobrecostes de cuenta es el límite del proveedor, que el conector no ha verificado. No afirmar gratuidad sin esa revisión.

## Coste y autorización

No se activa ningún recurso nuevo sin aprobación. Railway Pro incluye uso de recursos, no recursos ilimitados. Se estima consumo del controlador de aproximadamente $2–$4/mes según uso; ejemplo 0.25 GB RAM promedio + 0.05 vCPU promedio + 1 GB volumen ≈ $3.65/mes, antes de transferencia/modelos. Puede quedar dentro del crédito restante, pero su saldo no es visible con las herramientas conectadas. No es una cotización ni incremento de factura confirmado.

Se propone límite de 0.5 GB RAM / 0.25 vCPU y volumen 1 GB; a utilización continua de los topes serían ~$10.15/mes de esos recursos, antes de transferencia/modelos. No requiere VPS Docker permanente. GitHub Actions usa minutos incluidos mientras estén disponibles y el owner mantenga el spending stop; no se activa facturación extra aquí.

Fuentes oficiales consultadas: https://docs.railway.com/pricing/plans#included-usage , https://docs.railway.com/volumes#permissions , https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event , https://docs.github.com/en/billing/concepts/product-billing/github-actions .

## Qué prueba cada evidencia

Las pruebas locales validan HTTP real, persistencia SQLite, tickets/identidades, idempotencia, pausa/reanudación/cancelación, presupuestos y source bootstrap; el API GitHub de dispatch se simula sin tokens reales.

Los jobs CI `isolated-sandbox` y `remote-protocol-integration` ejecutan Docker real. El segundo recorre controlador HTTP → snapshot → contenedor → callback → recibo persistente/reutilización. Se prueba en runner temporal, no equivale a un controlador Railway desplegado ni a un dispatch autónomo autenticado entre ambas cuentas.

La imagen de controlador se prueba con volumen real y reinicio Docker en CI. El panel tiene prueba Chromium móvil/tablet. La conexión real DeepSeek, el dispatch público Railway→GitHub y el primer PR del publicador quedan pendientes de credenciales/activación y deben verificarse antes de declarar operativo.

## Preparación concreta, sin activación

El servicio `ad507-developer` (419d5122-4e9c-42f9-9b27-3a6bfaee2ae5) y el volumen `ad507-developer-data` de 1000 MB (ff3de8a0-a8b7-4c90-86d3-722270139397) quedaron **staged**, sin instancia, build o almacenamiento provisionado. Patch: 160fbbcf-e5cf-46f8-a46e-94de20562165. Incluye fuente fijada a la rama/revisión revisada, variables no secretas y `/data`; no incluye contraseñas o tokens ficticios. Los ID y los pasos están en `tools/ad507-agent/deploy/railway-plan.json`.

Limitación observada del conector: `update_service(staged=true)` devuelve `Service instance not found` para el servicio que solo existe en el patch. No se activó para eludir esa limitación. El Dockerfile se selecciona con `RAILWAY_DOCKERFILE_PATH`, que sí pudo dejarse staged. Los límites CPU/RAM, healthcheck y demás ajustes de instancia deben aplicarse/verificarse antes de ejecutar el despliegue aprobado. No afirmar que esos límites ya están aplicados.

Este proyecto tiene un único entorno cuyo nombre interno es `production`; pertenece a **leveia-staging**, no implica modificar las aplicaciones productivas. El patch debe contener únicamente el nuevo servicio y su nuevo volumen; nunca aceptar cambios ajenos o destructivos.
