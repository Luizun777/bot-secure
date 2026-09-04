# Convenciones — {{project}}

Lee esto cuando escribas código nuevo o revises un PR. Solo lo que difiere del default del lenguaje o del framework; lo estándar no se repite.

## Git
- Ramas: `{{branches.taskPrefix}}<ticket>-<slug>` desde `{{branches.ai}}`; PR hacia `dev`; `qa` y `prd` solo por promoción. Protegidas: {{branches.protectedList}}.
- Commits en español, imperativo, con ticket: `feat(pedidos): valida CLABE al capturar cuenta [TCK-123]`. Un cambio lógico por commit.
- PR con la plantilla de `.github/PULL_REQUEST_TEMPLATE.md`; evidencia real del test pegada.

## Código
{{#if hasConventions}}
{{#each conventions}}
- {{.}}
{{/each}}
{{/if}}
<!-- TODO (/bootstrap-contexto): por app, lo que difiere del default: formateador y config, nombres (español/inglés), estructura de carpetas, manejo de errores, logging (qué NO se loguea: PII), i18n. -->
- Nombres de tablas y campos con datos personales se documentan en `ARCHITECTURE.md` → "Datos sensibles"; en logs se enmascaran siempre.
- Configuración: campo sensible = `""` en la rama `{{branches.ai}}`; el loader de IA lo resuelve desde `.env.ai` con `AI_ENV=1`. No se añaden defaults con valores reales.

## Pruebas
- Ver `TESTING.md`. Datos de prueba sintéticos (`bot-secure db seed`, marcados `bot-secure:synthetic`); en unit tests, fixtures con valores de formato válido pero inventados.
- Toda corrección de bug trae su test.

## Documentación
- Cambió arquitectura, comandos, convenciones o runbook → actualiza el doc en el mismo PR (`/sync-docs`).
- Decisión con alternativas → ADR (`/adr`). Funcionalidad nueva → HU (`/hu`).
- Lecciones: regla de la 2ª vez → 1 línea en `CLAUDE.md`; detalle en `LESSONS.md`.
