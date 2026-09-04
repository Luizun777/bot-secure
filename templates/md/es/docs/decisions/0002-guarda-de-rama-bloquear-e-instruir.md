---
status: accepted
date: generado por bot-secure
decision-makers: equipo de {{project}}, InfoSec
---
# 0002 — La guarda de rama bloquea e instruye; no cambia de rama por su cuenta

## Contexto y problema
Si Claude Code se abre con una app en {{branches.protectedList}}, cualquier lectura o cambio ocurre sobre configuración e historia sin sanear. Hay que impedirlo sin romper el flujo del desarrollador ni tocar su árbol de trabajo sin permiso.

## Factores de decisión
- Fail-closed: si la guarda no puede evaluar, bloquea.
- Nunca modificar el repo del humano sin consentimiento explícito (cambios sin commit, worktrees, stash).
- El mensaje debe traer el comando exacto de arreglo.
- Debe funcionar en CLI y en la app de escritorio, en macOS, Linux y Windows.

## Opciones consideradas
1. Solo un aviso en `CLAUDE.md` ("trabaja en `{{branches.ai}}`").
2. Cambiar de rama automáticamente al detectar una protegida.
3. **Bloquear e instruir** en varias capas: SessionStart detecta la rama de cada app, escribe el flag `.claude/state/branch-blocked` e inyecta el comando exacto; UserPromptSubmit y PreToolUse deniegan mientras exista el flag (salvo `git status|branch|switch {{branches.ai}}`); la barra de estado muestra `⛔ <rama> BLOQUEADA → git switch {{branches.ai}}`; los hooks git y las reglas del servidor rematan.

## Decisión
Se elige la opción 3. El cambio automático queda como opt-in (`autoSwitch: true`) y solo en `startup`, con árbol limpio, sin worktree, con `{{branches.ai}}` existente y registrado en `.bot-secure/audit.log`.

### Consecuencias
- Positivas: ningún cambio inesperado en el repo del desarrollador; el arreglo es un comando visible; la integridad de las guardas se verifica en cada invocación.
- Negativas: la primera sesión en rama equivocada "no hace nada" hasta ejecutar `git switch {{branches.ai}}`.
- Neutras: `CLAUDE.md` informa, los hooks obligan, el servidor decide (PR obligatorio en `dev/qa/prd`).

### Confirmación
Prueba e2e: abrir en `dev` → flag creado, prompt denegado, statusline con ⛔; `git switch {{branches.ai}}` → flag eliminado y sesión normal.

## Más información
`docs/SECURITY.md` (tabla enforced vs best-effort), `.claude/rules/git-ramas.md`.
