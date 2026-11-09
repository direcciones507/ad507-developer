# AS Developer | Registro maestro y checklist

Fecha: 2026-11-09. Rama: `work/as-developer-agent-start-20261109`.
Propietario: AS Technologies. Estado: **desarrollo, no desplegado**.

## Decisiones permanentes
- Marca visible oficial: **AS Developer** / **AS Technologies**. Mantener identificadores internos heredados `AD507_*`, `ad507-developer` y rutas hasta una migración separada y probada.
- Código independiente en el repositorio público `direcciones507/ad507-developer`.
- Reutilizar **el mismo servicio** Railway `leveia-staging / ad507-developer` una vez aprobado; no crear otro proyecto o servicio.
- Mantener `direcciones507/leveia` privado e intacto, incluido el código anterior del agente.
- Conservar volumen persistente `/data`, dominio y variables del servicio. Antes de reconectar, respaldar y verificar restauración.
- Sin registro público. Acceso futuro de propietario con correo y contraseña; nunca almacenar credenciales en Git.
- GitHub Actions solo para CI de repositorio público, no como agente siempre activo.
- DeepSeek y publicación real desactivados hasta autorización explícita.

## Avance por entregables (ponderación de planificación, no cobertura de pruebas)
| Hito | Peso | Estado | Evidencia / siguiente paso |
|---|---:|---|---|
| Inventario de repositorio y Railway | 15% | Hecho | `docs/AS-DEVELOPER-INTEGRATION-20261109.md` |
| Rama independiente y CI público | 15% | Parcial | `.github/workflows/safe-ci.yml`; falta ejecución exitosa |
| Coordinación de roles y pruebas de contrato | 20% | Parcial | `src/agents.ts`, `src/agents.test.ts`; falta comprobar ejecución CI y tareas reales |
| Acceso propietario por correo y contraseña | 15% | Parcial | Formulario y validación opcional por `AD507_OWNER_EMAIL`, pruebas nuevas; falta configurar correo en Railway y verificar CI |
| Ejecutor aislado de código y pruebas reales | 15% | Pendiente | Railway no dispone de Docker; no abrir shell del controlador |
| Respaldo, cambio de origen Railway y rollback | 15% | Pendiente | Cambiar únicamente `ad507-developer` después de aceptación |
| Prueba integral de panel, tareas y aprobación | 5% | Pendiente | Verificación en URL real tras despliegue |

**Avance global estimado: 35%.** Este valor mide trabajo de preparación y desarrollo, no disponibilidad operativa.

## Registro de cambios
- `1789cd68b301`: CI acotado para Node 24, typecheck y tests.
- `afc696ea8e96`: análisis de cinco referencias open-source y límites de migración.
- `52a8e8def83f`: etapas lógicas PLAN / EXPLORE / PROPOSE / VERIFY / OWNER REVIEW en el motor existente.
- `486b233ba03d`: pruebas de contrato para etapas y reglas de seguridad.

- `7b8645b23c39` a `147afbb74261`: configuración, backend, formulario, cliente y ejemplo de variable de correo del propietario.\n- `9cd44e1287a4`: pruebas del login con correo, rechazo de correo incorrecto y configuración inválida.\n\n- `788fd9dfa991` a `d6a708b371dd`: marca visible AS Developer en panel, README y mensajes internos; identificadores de infraestructura intactos.\n- `bec13facfc15`: corrección de prueba de contraseña de fixture; fallo anterior identificado en GitHub Actions (`PASSWORD_MIN_16_CHARACTERS`).\n\n- `86a7ec458a56`: CI detectó un segundo test de migración que aún esperaba la marca antigua; se corrigió la aserción.\n\n## Bloqueos que no se deben ocultar
- CI aún no tiene una ejecución confirmada como exitosa.
- Los cinco roles son una política secuencial dentro del agente existente; **no** son cinco procesos autónomos independientes.
- Correo + contraseña está implementado en rama de desarrollo, pero exige configurar `AD507_OWNER_EMAIL` en Railway para hacer obligatoria la comprobación; falta confirmar pruebas y despliegue.
- No se ha conectado un ejecutor aislado para modificaciones de código.
- No hay despliegue ni migración del servicio Railway en esta rama.
- No se han descargado ni copiado íntegramente las aplicaciones Python externas. Se adoptan conceptos y se documenta su procedencia y licencias antes de incorporar código.

## Para la próxima persona que continúe
1. Verificar que Actions esté habilitado y revisar logs del workflow `safe-ci.yml`.
2. Resolver errores de typecheck/test sin desactivar comprobaciones.
3. Verificar las pruebas de correo + contraseña, configurar `AD507_OWNER_EMAIL` solo en Railway y comprobar acceso real sin exponer credenciales.
4. Construir o conectar ejecutor aislado autenticado, con límites de recursos y evidencia de pruebas.
5. Respaldar SQLite/volumen, probar rollback y solo entonces reconectar el servicio existente a `direcciones507/ad507-developer`.
6. Actualizar este archivo y registrar SHA, pruebas reales, decisiones y porcentaje después de cada hito.
