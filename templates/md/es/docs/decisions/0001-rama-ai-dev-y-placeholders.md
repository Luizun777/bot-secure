---
status: accepted
date: generado por bot-secure
decision-makers: equipo de {{project}}, InfoSec
---
# 0001 — La IA trabaja en la rama `{{branches.ai}}` con campo vacío y valores en `.env.ai`

## Contexto y problema
Queremos usar Claude Code sobre el código real de {{project}} sin que vea contraseñas, tokens, connection strings ni datos de clientes. El código de `dev` es correcto, pero su historia y su configuración pueden contener valores reales.

## Factores de decisión
- La frontera de seguridad es el contenido que Claude puede ver (viaja a la API).
- El código debe seguir funcionando localmente para que la IA pueda probar.
- Los cambios de la IA deben poder volver a `dev` por PR sin limpieza manual.
- Un placeholder que llegue a producción debe fallar ruidosamente, no silenciosamente.

## Opciones consideradas
1. Trabajar directo en `dev` y confiar en `.gitignore` y en el escáner.
2. Rama `{{branches.ai}}` con placeholders inline en la configuración.
3. Rama `{{branches.ai}}` con **campo vacío** en la configuración versionada y una única fuente de valores de IA (`.env.ai`) resuelta por un loader cuando `AI_ENV=1`.

## Decisión
Se elige la opción 3. `{{branches.ai}}` tiene el mismo código que `dev`; `sanitize` deja `""` en los campos sensibles y el loader de IA de cada stack aplica: vacío + `AI_ENV=1` → valor de `.env.ai`; vacío sin `AI_ENV` → error claro con el nombre del campo. `.env.ai` (versionado) contiene placeholders `__AI_PLACEHOLDER__<VAR>__` para credenciales que aceptan cualquier string y fakes válidos por formato (marcados `# bot-secure:fake <tipo>`) para SDKs que validan formato. `{{branches.ai}}` la actualiza solo CI (`bot-secure sync`); las tareas van en `{{branches.taskPrefix}}*` y regresan a `dev` por PR.

### Consecuencias
- Positivas: el humano en `{{branches.ai}}` solo deja el campo vacío; el gate de `dev/qa/prd` acepta vacío y rechaza valor real, placeholder o fake; el diff de vuelta a `dev` es limpio.
- Negativas: cada stack necesita un loader pequeño (`ai-env.ts`, `AiEnv.java`, `AiEnv.cs`, `ai_env.py`…); stacks no reconocidos requieren `envStrategy: manual`.
- Neutras: `AI_ENV=1` es un flag ortogonal, no un entorno nuevo (Spring sigue en `dev,ai`, .NET en `Development`).

### Confirmación
`bot-secure doctor --smoke` arranca cada app con `AI_ENV=1`; `scan --build` en `{{branches.ai}}` verifica que el artefacto usó `.env.ai`; el pipeline de `dev/qa/prd` falla ante `__AI_PLACEHOLDER__` o `bot-secure:fake`.

## Más información
`docs/RUNBOOK.md` (cómo funciona `AI_ENV=1`), `docs/SECURITY.md`, ADR 0002 y 0003.
