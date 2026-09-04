---
status: accepted
date: generado por bot-secure
decision-makers: equipo de {{project}}, InfoSec
---
# 0003 — Un workspace de IA (`{{project}}-ai/`) con todas las apps dentro

## Contexto y problema
{{project}} tiene varias piezas ({{appNames}}) que se necesitan mutuamente para probar algo real: el front consume al back, el back necesita una base de datos. Claude debe saber dónde está cada cosa y aplicar cambios en el lugar correcto sin que ninguna pieza apunte a servicios reales.

## Factores de decisión
- Una sola carpeta que Claude abra y que contenga contexto, guardas y código.
- Reproducible en otra máquina con un comando.
- Guardas que apliquen también si alguien abre una app sola.
- Sin datos ni servicios de producción alcanzables.

## Opciones consideradas
1. Un repo a la vez, cada uno con su `CLAUDE.md`, sin relación entre ellos.
2. Un monorepo artificial fusionando historiales.
3. **Workspace de IA**: carpeta `{{project}}-ai/` (monorepo: la raíz del repo; multi-repo: repo ligero que versiona lo generado y registra las apps en `policy.json.apps[]` como clones single-branch de `{{branches.ai}}`), con `AGENTS.md`/`CLAUDE.md`, `docs/`, `.claude/`, `mocks/` y `compose.ai.yml` en la raíz, y cada app con su `CLAUDE.md` corto y su `.claude/settings.json`.

## Decisión
Se elige la opción 3. El mapa de apps vive en `AGENTS.md` y en `docs/ARCHITECTURE.md`; `.claude/rules/<tipo>.md` con `paths:` orienta a Claude por carpeta; `compose.ai.yml` amarra BD ↔ back ↔ front en local; `bot-secure workspace clone` reproduce la carpeta; `bot-secure doctor --smoke` verifica la cadena completa.

### Consecuencias
- Positivas: Claude tiene una vista completa y coherente; los cambios que cruzan apps se planean juntos; las guardas verifican la rama de cada app en cada sesión.
- Negativas: en multi-repo hay dos niveles de git (workspace y apps); `sync` debe correr por app.
- Neutras: lo generado se versiona en el workspace y queda auditable; cada app conserva su repo y su CI.

### Confirmación
`bot-secure status` lista cada app con rama y estado; `AGENTS.md` ≤ 80 líneas con el mapa; test de que cada app registrada tiene `CLAUDE.md` y `.claude/settings.json` con el mismo hash que la raíz.

## Más información
`AGENTS.md` (mapa de apps), `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`.
