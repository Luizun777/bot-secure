---
description: Ramas y git — aplica siempre; el flujo {{branches.taskPrefix}}* → {{branches.ai}} → dev → qa → prd.
---
# Ramas y git (siempre)

## Dónde puedes trabajar
- Solo en `{{branches.ai}}` o en una rama `{{branches.taskPrefix}}<ticket>-<slug>` creada **desde** `{{branches.ai}}`.
- Ramas protegidas: {{branches.protectedList}}. Nunca `git switch`, `git checkout`, `git commit`, `git merge`, `git push` ni `git rebase` sobre ellas. Los hooks lo bloquean; no busques la forma de rodearlos.
- Si ves ⛔ en la barra de estado, estás fuera de sitio: `git switch {{branches.ai}}` (en un monorepo con clones, en la app que marque: `git -C <app> switch {{branches.ai}}`).

## Flujo
`{{branches.taskPrefix}}<ticket>-<slug>` → `{{branches.ai}}` → `dev` → `qa` → `prd`.
- `{{branches.ai}}` la actualiza **solo CI** (`bot-secure sync`); no la mezcles a mano desde `dev`.
- El trabajo vuelve a `dev` por PR, con la plantilla de `.github/PULL_REQUEST_TEMPLATE.md`.

## Commits
- En español, imperativo, pequeños, uno por cambio lógico, con el ticket: `fix(pedidos): valida CLABE antes de guardar [TCK-123]`.
- Nunca commitees `.env*` reales, dumps, binarios grandes ni archivos de `.claude/state/`.
- No uses `git add -A` a ciegas: revisa `git status` y añade rutas concretas.

## Comandos que no debes ejecutar
- `git push --force` / `--force-with-lease` sobre cualquier rama compartida, `git reset --hard` sobre trabajo no tuyo, `git clean -fdx` sin confirmación del humano.
- Reescritura de historia (`filter-branch`, `filter-repo`, `rebase -i` sobre commits ya publicados): es tarea de `bot-secure`, no tuya.
- Cambiar `remote`, `core.hooksPath` o la configuración de git del repo.

## Si el hook bloquea
El motivo está en el mensaje y en `.bot-secure/audit.log`. Casi siempre es rama o secreto: corrige la causa. Si crees que el bloqueo es incorrecto, dilo al humano y para; no desactives hooks.
