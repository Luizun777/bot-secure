# Para el equipo de Seguridad de la Información

> Lee esto si tienes que aprobar el uso de Claude Code en repos con datos sensibles.

## Qué problema resuelve bot-secure

Cuando un desarrollador usa Claude Code, **todo archivo que Claude lee viaja a la API de Anthropic** y queda una copia en texto plano en su máquina (`~/.claude/projects/<proyecto>/*.jsonl`). Ningún contenedor ni sandbox cambia eso. Por tanto, la única defensa real es que **los secretos y la PII no estén en lo que Claude puede ver**.

bot-secure hace tres cosas:

1. **Sanea el contenido**: escanea el repo (incluida la historia git), reporta secretos y PII enmascarados, y crea una copia de trabajo para la IA (`ai-dev`) donde los valores reales quedan vacíos o sustituidos por valores falsos válidos.
2. **Limita lo que Claude puede hacer**: reglas `deny` y hooks que bloquean lectura de archivos sensibles, comandos de red, cambios a ramas productivas y escritura de secretos. Fail-closed: si una guarda no puede evaluar, bloquea.
3. **Deja evidencia**: reportes con hash, `attest` con versiones y firmante, `audit.log` de cada bloqueo, y este paquete de organización.

## Qué está garantizado y qué no

| Control | Tipo | Quién lo hace cumplir |
|---|---|---|
| Check `bot-secure` obligatorio en todo PR a `dev` | **enforced** | GitHub (rulesets) |
| `dev`, `qa`, `prd` solo por PR, sin force push | **enforced** | GitHub |
| `CODEOWNERS` de InfoSec sobre `.claude/**`, `.githooks/**`, `.bot-secure/**` | **enforced** (GitHub Team+) | GitHub |
| Reglas `deny`, hooks, sandbox nativo | best-effort | Máquina del dev (puede editarlas) |
| Managed settings de Claude Code | **enforced** si hay MDM o plan Team/Enterprise | IT |
| Clon single-branch / repo espejo sin historia contaminada | best-effort (verificado en cada sesión) | Máquina del dev |

**Sin plan Team/Enterprise ni MDM, todo lo local es best-effort.** El bot lo detecta y lo dice en `bot-secure doctor`.

## Cuentas personales de Claude: el riesgo #1

Si los desarrolladores usan cuentas Free/Pro/Max personales:

- Con el ajuste "Help improve Claude" activo, Anthropic **puede entrenar** con el contenido y **retenerlo 5 años**.
- No aplican los términos comerciales ni un DPA.
- No existen managed settings: cualquier control local puede desactivarse.

Recomendación en orden:

1. Migrar a **Claude Team o Enterprise** (sin entrenamiento, retención 30 días, consola de administración) o usar la **API** (directa, Bedrock o Vertex).
2. Mientras tanto: cada dev apaga "Help improve Claude" en claude.ai/settings/privacy; el bot fija `DISABLE_FEEDBACK_COMMAND`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` y `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` para cerrar los canales que retienen 5 años.
3. `bot-secure doctor` avisa cuando la cuenta es personal; con `requireOrgAccount: true` en `policy.json` bloquea la sesión.

## Paquete de organización (`bot-secure org-pack`)

Genera en `infosec/`:

- `managed-settings.json`: para desplegar por MDM (Jamf/Intune) o en `/Library/Application Support/ClaudeCode/` (macOS), `/etc/claude-code/` (Linux), `C:\Program Files\ClaudeCode\` (Windows). Incluye `disableBypassPermissionsMode`, `allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `allowedMcpServers` cerrado y el sandbox forzado.
- `rulesets.json` + `apply.sh`: protección de ramas para GitHub, la ejecuta un administrador con `gh`.
- `checklist-contrato.md`: qué pedir al contratar (Team/Enterprise, DPA, ZDR si aplica).
- `enforced-vs-best-effort.md`: la tabla anterior con el estado real del repo.

## Evidencia para auditoría

- `bot-secure scan` → `report.json` con `reportSha256`, commit, versión de reglas y hallazgos **enmascarados** (nunca el valor; huella HMAC con llave fuera del repo).
- `bot-secure attest --rotation-id <ticket>` → manifiesto firmado con hash del reporte, versiones, resultado de `doctor` y quién lo emitió.
- `.bot-secure/audit.log` → cada bloqueo del guard (fecha, evento, herramienta, motivo; sin valores).
- `INCIDENT-*.md` → se crea si un secreto llegó a viajar a la API (el guard escanea el transcript al cerrar sesión).

## Mapeo a marcos

- **OWASP Top 10 for LLM 2025**: LLM01 Prompt Injection (deny de red, allowlist FQDN, Bash tratado como lector), LLM02 Sensitive Information Disclosure (contenido saneado, deny de lectura, escaneo), LLM06 Excessive Agency (permisos mínimos, ramas protegidas).
- **ISO/IEC 27001:2022**: A.8.11 enmascaramiento (placeholders y fakes), A.8.12 prevención de fuga (deny, sandbox, escáner), A.8.31 separación de ambientes (`ai-dev`, BD de pruebas), A.5.23 servicios en la nube (plan comercial).
- **SOC 2**: CC6 (acceso lógico), CC7 (detección), CC8 (cambios bajo CODEOWNERS).
- **LFPDPPP (México, 2025)**: los datos que viajan a Anthropic son una transferencia; con datos sintéticos en `ai-dev` desaparece el tratamiento de datos reales.

## Límites que debes conocer

- Un escáner por patrones nunca es completo. El bot lo dice en cada reporte.
- El allowlist de dominios es defensa en profundidad, no frontera (domain fronting).
- Otras herramientas de IA (Cursor, Copilot, web) no están cubiertas: requieren política corporativa.
