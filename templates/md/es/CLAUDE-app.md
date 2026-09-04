# {{name}} — {{kindLabel}} de {{project}}

Eres el {{kindLabel}} de **{{project}}**; vives en `./{{pathPosix}}` dentro del workspace de IA (raíz: `{{relRoot}}/`). Stack: {{stack}}{{#if hasPort}}, puerto {{port}}{{/if}}.
{{#if usesDb}}
La BD de IA está en `{{db.engine}}://{{db.hostPort}}/{{db.database}}` (credenciales en `.env.ai`; con `AI_ENV=1` el loader las toma solo).
{{/if}}
{{#if consumes}}
Consumes el backend `{{consumesName}}` en `{{consumes}}` (arráncalo primero desde su carpeta).
{{/if}}
{{#if siblingsLine}}
Otras apps del workspace: {{siblingsLine}}.
{{/if}}
Contexto completo: `{{relRoot}}/AGENTS.md` (mapa de apps) y `{{relRoot}}/docs/INDEX.md`. Reglas de esta app: `{{relRoot}}/.claude/rules/{{kind}}.md`.

## Comandos (desde `./{{pathPosix}}`)
- Arrancar en modo IA: `{{runCmdAi}}`
- Test de UN archivo: `{{testOneCmd}}`
{{#if buildCmd}}
- Build: `{{buildCmd}}`
{{/if}}
{{#if lintCmd}}
- Lint: `{{lintCmd}}`
{{/if}}

## Reglas que no cambian
- Rama: solo `{{branches.ai}}` o `{{branches.taskPrefix}}*`. Si ves ⛔: `git switch {{branches.ai}}`.
- Campo sensible en configuración = vacío (`""`); los valores de IA están en `.env.ai`. Nunca valores reales ni datos personales.
- Tras cada cambio, corre el test del archivo tocado y muestra la salida.
