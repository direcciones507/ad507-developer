# AD507 Developer multiproyecto — 19 octubre 2026

Continúa PR359 y el único servicio existente. No cambia aplicaciones LEVEIA, Direcciones 507/LATAM, ReportaPA o Empleos.pa en producción.

## Proyectos y autorización

Registro inicial autorizado por el propietario: Junta Comunal de Santiago (solo docs), LEVEIA, Direcciones 507/LATAM, ReportaPA y Empleos.pa. Los nombres/capitalización de repositorios se comprobaron con GitHub. Ningún otro repositorio queda autorizado por disponer de un token.

`projects` en SQLite conserva incorporaciones del propietario. Panel privado → Autorizar un nuevo proyecto → confirmación expresa; API POST /api/projects exige sesión, Origin y CSRF. No es una herramienta del modelo. Repositorio, rama base y permisos quedan inmutables tras registrar; no se retargetean tareas antiguas. Un repositorio no se registra dos veces. Cada tarea usa copia independiente, rama ad507/task-UUID y su propio directorio. Preparación admite únicamente docs/.

Tokens por proyecto: AD507_PROJECT_DIRECCIONES507_GITHUB_TOKEN, AD507_PROJECT_REPORTAPA_GITHUB_TOKEN, AD507_PROJECT_EMPLEOS_PA_GITHUB_TOKEN; futuros: AD507_PROJECT_<ID_MAYUSCULAS_CON_GUIONES_BAJOS>_GITHUB_TOKEN. LEVEIA conserva AD507_LEVEIA_GITHUB_TOKEN. El token genérico histórico solo sirve LEVEIA, nunca se hereda hacia nuevos repositorios. Configurar permisos finos por repositorio: Contents read para fuente; Contents write + Pull requests write si se habilita publicador. La cuenta del conector ChatGPT no se transfiere a Railway.

Actions sigue siendo el broker confiable en direcciones507/leveia, con token Actions write exclusivo, SHA/ref revisados y tickets por snapshot. Los repositorios no necesitan un servicio o workflow nuevo. Para LEVEIA se conservan checks existentes. Otros proyectos disponen de project-syntax (JS/JSON sin instalar paquetes ni ejecutar scripts del proyecto); se informa que esto NO valida compilación, tipos ni comportamiento. Añadir checks/dependencias específicos requiere revisión del operador: el registro de proyecto no habilita comandos arbitrarios. Ningún modelo puede editar workflow, Dockerfile o manifiestos de dependencias.

## DeepSeek exclusivo

El runtime rechaza AD507_PROVIDER=openai y no contiene endpoint o fallback OpenAI. Se retiró @openai/agents de las dependencias directas del agente; el producto educativo conserva sus propios proveedores sin modificaciones. simulation permanece únicamente como herramienta de pruebas sin inferencia; Railway queda configurado deepseek con AD507_LIVE_ENABLED=false.

LEVEIA apps/api/src/model.ts usa DEEPSEEK_API_KEY y endpoint compatible https://api.deepseek.com/chat/completions; su valor por defecto deepseek-v4-flash es un alias legado. El agente reutiliza el contrato HTTP y tool calls, no el router educativo ni su fallback. Modelo preparado deepseek-flash, thinking disabled para herramientas; ninguna solicitud habilita herramientas de búsqueda externas facturables. Fallos HTTP se registran como código, detienen tarea y no hacen reintentos pagados automáticos.

Se verificó por nombres (sin leer valores) que la API de LEVEIA en meticulous-elegance tiene DEEPSEEK_API_KEY; la API de leveia-staging no la tiene. Son proyectos Railway distintos: la referencia de variable de servicio funciona dentro de un proyecto y no transfiere esa clave entre ellos. OAuth solo devuelve nombres; no se extrajo ni publicó el valor. El propietario puede guardar la MISMA clave existente como DEEPSEEK_API_KEY en el servicio AD507, sin crear cuenta/clave nueva. No se copian DATABASE_URL, OPENAI_API_KEY, secretos de producto ni volúmenes. Si no conserva el valor original, la recuperación/gestión se realiza en DeepSeek por el propietario; no rotar una clave usada por LEVEIA sin coordinarlo.

Presupuestos separados de LEVEIA: reserva conservadora antes de cada llamada, tope inicial US$0.25 por tarea, US$1 por proyecto y US$1 global del agente (AD507_BUDGET_MICROUSD=1000000). Son reservas acumuladas sin reset automático ni devolución de llamadas inciertas; no saldo/factura del proveedor. Tokens reales de respuesta se registran por tarea. Mantener un trabajador y ninguna conmutación de proveedor.

Tarifas oficiales verificadas 19-oct-2026 para deepseek-flash: pico/cache miss US$0.30 por millón de entrada y US$1.20 por millón de salida; fuera de pico US$0.15/US$0.60. Reserva configurada con tarifas de pico (0.3 y1.2 microUSD/token), sin asumir cache hit. Modelo, tarifa y límite deben revisarse antes de habilitar consumo. Primera llamada facturable pendiente de autorización explícita; live=false aunque se cargue la clave. Fuente: https://api-docs.deepseek.com/quick_start/pricing/ y https://api-docs.deepseek.com/guides/tool_calls/.

## Infraestructura y verificación

Mismo servicio ad507-developer en leveia-staging, volumen exclusivo1000MB /data, SQLite, HTTPS y contraseña existente. Sin infraestructura adicional ni cambios de límites globales. Vigilancia horaria ChatGPT de métricas AD507: estimaciones preventivas2/3/4USD, no alertas nativas de factura ni hard limit; ciclo de facturación y crédito restante no disponibles mediante conector.

Base4301e05 ya verificada en Railway: login200, API sin sesión401, tarea simulada0a30099c-867c-47f8-baf9-b2faee88db38, archivo y10 eventos conservados tras restart_service real. No repetir ni presentar esta evidencia como primera inferencia real.

Ampliación: pruebas locales y CI para registro/API/CSRF, dos repositorios y tokens aislados, recuperación de registro, presupuesto conjunto, OpenAI bloqueado, navegador móvil/tablet y check genérico en Docker. Registrar resultados de CI y del despliegue en PR359. Pendientes explícitos: prueba física desde tablet, DeepSeek real autorizado, token de broker/proyectos, origen GitHub y minutos incluidos, recorrido público Railway→Actions→callback y primer PR del publicador. No declarar completo ese recorrido con mocks ni crear un PR manual en su lugar.
