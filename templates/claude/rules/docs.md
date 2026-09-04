---
description: Cómo se escribe la documentación de {{project}} (docs/, HU, ADR, lecciones).
paths: {{rulePaths}}
---
# Documentación

## Principio
La documentación es contexto que la IA carga: cuanto más corta y verdadera, mejor. Escribe lo que difiere del default; lo estándar del lenguaje o del framework no se documenta.

## Nunca en un documento
- Valores reales: contraseñas, tokens, connection strings, hosts o IPs de producción, buckets, nombres de servidores.
- Datos personales: RFC, CURP, CLABE, NSS, tarjetas, correos o teléfonos de personas reales. Los ejemplos son sintéticos (`@ai.local`, seed del workspace).
- Capturas o pegados de logs sin revisar: enmascara antes.

## Dónde va cada cosa
- `docs/INDEX.md` — una línea por documento: qué es y cuándo leerlo. Si creas un documento, añádelo aquí.
- `docs/ARCHITECTURE.md` — mapa back ↔ front ↔ BD, capas, fronteras, datos sensibles por entidad.
- `docs/CONVENTIONS.md` · `docs/TESTING.md` · `docs/RUNBOOK.md` · `docs/SECURITY.md` · `docs/GLOSSARY.md`.
- `docs/decisions/` — ADR (MADR en español). Decisión con alternativas → `/adr`. Un ADR no se borra: se marca `superseded by NNNN`.
- `docs/user-stories/` — HU con criterios Gherkin `# language: es` → `/hu`; actualiza `INDEX.md` con el estado.
- Lecciones: 1 línea en `CLAUDE.md` → "Lecciones aprendidas" (máximo 10); el detalle en `docs/LESSONS.md`.

## Cómo se escribe
- Español claro, frases cortas, voz activa. Comandos exactos y copiables. Marca lo que falta con `<!-- TODO: … -->`, nunca lo inventes.
- Si no estás seguro de un dato del proyecto, escríbelo con `(?)` y pregúntale al humano; una afirmación falsa en docs se propaga a todas las sesiones.
- Cambió arquitectura, comandos, convenciones o runbook → actualiza el documento en el **mismo PR** (`/sync-docs` te dice qué quedó desfasado).
- Respeta los presupuestos de líneas: `CLAUDE.md` raíz ≤ 60, `AGENTS.md` ≤ 80, `CLAUDE.md` de app ≤ 25. Lo que sobre, va a `docs/`.
