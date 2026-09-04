---
name: adr
description: Registra una decisión de arquitectura en docs/decisions/ con formato MADR en español (contexto, opciones, decisión, consecuencias). Invócala con /adr.
disable-model-invocation: true
argument-hint: <título de la decisión en presente>
---
# Registrar una decisión de arquitectura (ADR)

Procedimiento para `/adr`. No lo ejecutes por tu cuenta: solo cuando el humano lo invoque.

## Cuándo aplica
Hay ADR cuando la decisión es difícil de revertir o afecta a más de una app: elección de librería o motor, contrato de API, esquema de datos, estrategia de autenticación, forma de desplegar, convención transversal. Un cambio de una función no es un ADR.

## Pasos
1. Lista `docs/decisions/` y toma el siguiente número consecutivo (4 dígitos; los ADR 0000-0003 ya existen).
2. Copia `docs/decisions/0000-plantilla-adr.md` a `docs/decisions/NNNN-<slug>.md` (minúsculas, sin acentos, guiones).
3. Frontmatter: `status: proposed` (el humano lo pasa a `accepted`), `date` de hoy en `AAAA-MM-DD`, `decision-makers`, `consulted`, `informed`.
4. `## Contexto y problema`: 2-5 líneas neutrales, qué fuerza la decisión ahora.
5. `## Factores de decisión`: seguridad y privacidad de datos primero, luego costo, tiempo, mantenibilidad, operación.
6. `## Opciones consideradas`: al menos dos reales (incluye "no hacer nada" si aplica).
7. `## Decisión` y `### Consecuencias` (positivas, negativas, neutras) y `### Confirmación`: cómo se verifica que se cumple (test, hook, revisión, métrica).
8. `## Pros y contras de cada opción`.
9. Si sustituye a un ADR anterior: marca el viejo `superseded by NNNN` y enlaza; **nunca borres un ADR**.
10. Enlaza el ADR desde `docs/ARCHITECTURE.md` si cambia el mapa, y menciónalo en el PR.

## Reglas
- Sin valores reales, hosts, IPs ni datos personales: nombres de tecnologías y patrones, no credenciales ni endpoints de producción.
- Si no conoces una alternativa que el equipo consideró, pregunta antes de escribirla; no inventes historia.
- Español, presente, frases cortas. El ADR explica **por qué**, no cómo se programa.
