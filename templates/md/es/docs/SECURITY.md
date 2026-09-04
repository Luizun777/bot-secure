# Seguridad de la información — {{project}} (workspace de IA)

Lee esto cuando dudes si algo se puede leer, copiar, pegar o mandar a la API. Regla corta: **si es un valor real de una persona o de un sistema, no.**

## Qué es sensible aquí (taxonomía)
| Tipo | Ejemplos | Qué hacer en este workspace |
|---|---|---|
| Identificadores de persona (MX) | RFC, CURP, NSS, INE/clave de elector, pasaporte | nunca valores reales; sintéticos con checksum válido (`bot-secure db seed`) |
| Datos bancarios | CLABE, número de tarjeta (PAN), CVV, cuenta | sintéticos; tarjetas de prueba del proveedor; nunca dumps |
| Contacto | correo, teléfono, dirección de clientes/empleados | `persona@ai.local`, `+52 55 0000 xxxx`, direcciones del catálogo sintético |
| Credenciales | contraseñas, API keys, tokens, client secrets, connection strings, certificados/llaves | campo vacío en configuración; placeholder `__AI_PLACEHOLDER__X__` o fake marcado en `.env.ai` |
| Infraestructura | hosts, IPs, buckets, nombres de servidores de prod | no se copian a docs ni prompts; `<host>` |
| Datos de negocio | precios negociados, contratos, nómina | no forman parte del workspace |

## Qué viaja a la API de Anthropic
Todo lo que Claude lee o tú escribes en la sesión: prompts, archivos abiertos, salidas de comandos, diffs. No viaja lo que está bloqueado por `permissions.deny` y el sandbox (`.env*`, llaves, `~/.ssh`, `.bot-secure/reports`, etc.) mientras no lo pegues a mano.
Transcripts y memoria quedan **en tu máquina**: `~/.claude/projects/<slug>/` (JSONL de cada sesión y `memory/`). Contienen todo lo leído. El bot fija `cleanupPeriodDays: 7` y `autoMemoryEnabled: false`; las lecciones van a git (`CLAUDE.md`, `docs/LESSONS.md`).

## Qué está garantizado y qué es best-effort
| Control | Mecanismo | Nivel |
|---|---|---|
| No leer `.env`, llaves, dumps | `permissions.deny` + sandbox `denyRead` + hook PreToolUse (Bash tokenizado) | enforced (nivel ≥ 1) |
| No salir de la rama `{{branches.ai}}`/`{{branches.taskPrefix}}*` | SessionStart + UserPromptSubmit + PreToolUse + hooks git + reglas del servidor | enforced |
| Sin egreso a hosts no permitidos | sandbox `allowedDomains` (FQDN exacto) + deny de `curl|wget|…` | enforced con sandbox; best-effort en Windows nativo |
| Secretos en prompts/archivos nuevos | escáner en UserPromptSubmit y PreToolUse Edit/Write | best-effort (detección) |
| Secretos pegados a mano en el chat | escáner del prompt; SessionEnd revisa el transcript e informa | best-effort |
| Integridad de guardas | sha256 contra `lock.json` en cada invocación | enforced |
| Datos de prueba sintéticos | `bot-secure db`; no existe `db import` | por diseño |
| App de escritorio de Claude | hooks y deny aplican; el entorno del proceso no se limpia | best-effort |

"Sin hallazgos" no significa "sin secretos": el escáner detecta patrones conocidos y entropía, no intención.

## Cuentas personales y privacidad
Con una cuenta personal (sin organización), las conversaciones pueden usarse para mejorar modelos si el toggle "Help improve Claude" está activo. Recomendación #1: cuenta de organización (Team/Enterprise/API). Si usas personal: apaga el toggle en la configuración de privacidad; `bot-secure doctor` avisa y `policy.requireOrgAccount: true` lo convierte en bloqueo. El bot desactiva `/feedback`, encuestas y telemetría no esencial.

## Clave pública vs clave secreta (por proveedor)
| Proveedor | Pública (puede ir en front/versionada) | Secreta (solo `.env.ai` como fake, nunca real) |
|---|---|---|
| Stripe | `pk_test_…` / `pk_live_…` | `sk_…`, `rk_…`, `whsec_…` |
| Firebase / Google | `apiKey` web (restringida por dominio), `projectId` | service account JSON, `FIREBASE_TOKEN` |
| Supabase | `anon` key (con RLS) | `service_role` key, contraseña de BD |
| Clerk / Auth0 / Azure AD | `pk_test_…`, `clientId`, `tenantId`, `issuer` | `sk_…`, `clientSecret`, certificados |
| AWS | región, nombre de bucket (no en prod) | `AKIA…` + secret, session token |
| Twilio / SendGrid / Mapbox | Account SID / token público restringido | Auth token, API key |
| reCAPTCHA | site key (llaves oficiales de prueba en IA) | secret key |
Una clave "pública" de producción sigue siendo un identificador de tu cuenta: en IA usa la de test o un fake.

## Si encuentras un valor real
1. No lo copies al chat, a un archivo ni a un commit. 2. Anota archivo y línea. 3. Propón campo vacío + variable en `.env.ai`. 4. Avisa a {{#if hasInfosec}}{{owners.infosec}}{{/if}}{{#unless hasInfosec}}InfoSec (define `owners.infosec` en `.bot-secure/policy.json`){{/unless}} para rotarlo (SLA 24 h). 5. `bot-secure attest --rotation-id <id>` cuando esté rotado.

## Referencias
OWASP LLM Top 10 2025 (LLM01 prompt injection, LLM02 fuga de información sensible, LLM06 agencia excesiva) · ISO 27001 A.8.11/A.8.12/A.8.31 · SOC 2 CC6/CC7/CC8 · LFPDPPP (México).
