---
name: sync-docs
description: Revisa qué documentación quedó desfasada respecto al código cambiado y la actualiza en el mismo PR. Invócala con /sync-docs.
disable-model-invocation: true
argument-hint: [rango de commits o ruta]
---
# Sincronizar la documentación

Procedimiento para `/sync-docs`, antes de abrir un PR. No lo ejecutes por tu cuenta.

## Pasos
1. Mira qué cambió: `git status` y `git diff --stat` contra `{{branches.ai}}` (o el rango que te den). Trabaja solo sobre eso, no revises el repo entero.
2. Aplica el mapa cambio → documento:
   | Cambió | Actualiza |
   |---|---|
   | Endpoint, contrato, esquema de datos, frontera entre apps | `docs/ARCHITECTURE.md` |
   | Comando de arranque, build, lint, puerto | `AGENTS.md`, `docs/RUNBOOK.md`, `CLAUDE.md` de la app |
   | Variable nueva de `.env.ai` | `docs/RUNBOOK.md` (nombre y para qué, **nunca el valor**) y `.env.ai` |
   | Framework, ruta o comando de pruebas | `docs/TESTING.md` |
   | Convención de código, commits o PR | `docs/CONVENTIONS.md` |
   | Entidad que ahora guarda datos personales | `docs/ARCHITECTURE.md` (datos sensibles) y `docs/SECURITY.md` |
   | Sigla o término nuevo del negocio | `docs/GLOSSARY.md` |
   | Decisión con alternativas | `/adr` |
   | Funcionalidad terminada | estado de la HU en `docs/user-stories/INDEX.md` |
   | Error repetido | 1 línea en `CLAUDE.md` → Lecciones aprendidas; detalle en `docs/LESSONS.md` |
3. Verifica lo que documentes: si tocas un comando, ejecútalo y pega la salida real.
4. Reporta al humano: documentos actualizados, y una lista de lo que **no** pudiste confirmar (marcado `(?)`).

## Reglas
- Sin valores reales, hosts, IPs ni datos personales en ningún documento.
- No reescribas documentos completos: cambios quirúrgicos sobre lo que quedó desfasado.
- Respeta los presupuestos: `CLAUDE.md` ≤ 60 líneas, `AGENTS.md` ≤ 80, `CLAUDE.md` de app ≤ 25. Lo que sobre baja a `docs/`.
- Si un documento generado por `bot-secure` ya no refleja la realidad (mapa de apps, puertos), la fuente es `.bot-secure/policy.json`: dilo al humano en vez de editar a mano.
