@AGENTS.md

## Claude Code
- IMPORTANT: trabaja SOLO en `{{branches.ai}}` o en ramas `{{branches.taskPrefix}}*`. Si ves ⛔ en la barra de estado: `git switch {{branches.ai}}` (en la app que marque: `git -C <app> switch {{branches.ai}}`). Nunca `git switch`/`checkout` a {{branches.protectedList}}.
- IMPORTANT: cero secretos y cero datos personales reales en código, docs, tests o prompts. Regla del campo vacío: en `{{branches.ai}}` un campo sensible de configuración queda `""`; los valores de IA viven en `.env.ai`. No leas `.env*` ni pidas que te los peguen.
- Cambio multi-archivo o que cruce apps → plan mode primero e indica qué app tocas (mapa de apps en AGENTS.md). Cambio de una frase → directo.
- Exploración amplia → subagente `explorador` (devuelve rutas + resumen). Antes de un PR → `/revision-seguridad` o subagente `revisor-seguridad`.
- Evidencia, no afirmaciones: tras cada cambio ejecuta el test del archivo tocado (comando en AGENTS.md) y muestra la salida real.
- Nueva HU → `/hu` · nueva decisión → `/adr` · docs desactualizadas → `/sync-docs` · primer día en el proyecto → `/bootstrap-contexto` (plan mode).
{{#if hasDb}}
- Arranca siempre con `AI_ENV=1`; la BD de IA está en `{{db.hostPort}}` (`bot-secure up` si está abajo).
{{/if}}
- Si un hook bloquea una acción, lee el motivo: casi siempre es rama o secreto. No intentes rodearlo; pide el cambio al humano.

## Lecciones aprendidas
<!-- Máximo 10 líneas. Regla de la 2ª vez: si el mismo error ocurre dos veces, añade aquí 1 línea (qué pasó → qué hacer). Las lecciones largas van a docs/LESSONS.md. -->
{{lessons}}

## Al compactar
Preserva siempre: app y rama en las que trabajas, archivos modificados, comandos de test usados, decisiones tomadas y lecciones nuevas. Tras compactar, relee `AGENTS.md` (mapa de apps) antes de seguir.
