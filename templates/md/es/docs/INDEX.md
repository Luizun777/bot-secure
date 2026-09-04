# Índice de documentación — {{project}}

Lee esto cuando no sepas dónde está algo. Una línea por documento: qué es y cuándo leerlo.

| Documento | Qué es | Léelo cuando… |
|---|---|---|
| `ARCHITECTURE.md` | Mapa back ↔ front ↔ BD, capas y flujo de una petición | vayas a tocar más de una app o una frontera (API, BD, auth) |
| `CONVENTIONS.md` | Convenciones de código, commits y PR que difieren del default | escribas código nuevo o revises un PR |
| `TESTING.md` | Cómo correr UN test por app, dónde viven y qué datos usan | termines un cambio (evidencia) o añadas pruebas |
| `RUNBOOK.md` | Arranque con `AI_ENV=1` por app, BD de IA, puertos, dependencias y mocks | algo no arranca o necesitas una variable nueva |
| `SECURITY.md` | Qué es sensible aquí, qué viaja a la API, qué está garantizado y qué es best-effort | dudes si algo se puede leer, copiar o pegar |
| `GLOSSARY.md` | Siglas mexicanas (RFC, CURP, CLABE, NSS…) y términos del workspace | veas una sigla que no conoces |
| `LESSONS.md` | Lecciones largas del proyecto (las cortas están en `CLAUDE.md`) | repitas un error o empieces una tarea parecida a otra |
| `decisions/` | Decisiones de arquitectura (ADR, formato MADR en español) | quieras saber por qué algo es así o vayas a cambiarlo (`/adr`) |
| `user-stories/` | Historias de usuario con criterios Gherkin en español | implementes una funcionalidad (`/hu` para crear una) |

Raíz del workspace: `AGENTS.md` (mapa de apps y comandos) y `CLAUDE.md` (reglas para Claude Code). Cada app tiene su `CLAUDE.md` corto.
