---
name: hu
description: Crea una historia de usuario nueva en docs/user-stories/ con criterios Gherkin en español y la registra en el índice. Invócala con /hu.
disable-model-invocation: true
argument-hint: <título corto de la historia> [épica]
---
# Crear una historia de usuario (HU)

Procedimiento para `/hu`. No lo ejecutes por tu cuenta: solo cuando el humano lo invoque.

## Pasos
1. Lee `docs/user-stories/INDEX.md` y toma el número consecutivo libre (`HU-NNNN`, 4 dígitos). Si el índice no existe, empieza en `HU-0001`.
2. Copia `docs/user-stories/_PLANTILLA-HU.md` a `docs/user-stories/HU-NNNN-<slug>.md`. El slug: minúsculas, sin acentos, palabras con guiones, máximo 50 caracteres.
3. Rellena el frontmatter: `id`, `epica` (la del argumento o pregunta), `estado: borrador`, `prioridad` (baja|media|alta), `owner`, `datos-sensibles` con los **tipos** involucrados (`[RFC, CLABE, correo]`), nunca valores.
4. Escribe `## Historia` con **Como** / **quiero** / **para**: rol concreto, acción concreta, valor de negocio. Una frase cada uno.
5. Escribe `## Criterios de aceptación` en un bloque ` ```gherkin ` que empiece con `# language: es` y use `Característica`, `Antecedentes`, `Escenario`, `Dado`, `Cuando`, `Entonces`, `Y`, `Pero`, `Esquema del escenario` y `Ejemplos`. Como mínimo: un camino feliz, un caso de error y un borde.
6. Completa `## Datos sensibles involucrados` (tipo · para qué · cómo se mockea en IA), `## Fuera de alcance` y la `## DoD`.
7. Añade la fila a la tabla de `docs/user-stories/INDEX.md`.
8. Muestra al humano la ruta creada y el resumen; no implementes nada todavía.

## Reglas
- Todos los ejemplos con datos **sintéticos**: personas inventadas, correos `@ai.local`, RFC/CURP/CLABE/NSS del seed (`bot-secure db seed`) o con dígito verificador válido pero de persona inexistente.
- Si te falta información (rol, regla de negocio, criterio de error), no la inventes: escríbela con `(?)` y pregunta al humano al final.
- No toques código ni tests en este flujo. La implementación es una tarea aparte, con su rama `{{branches.taskPrefix}}<ticket>-<slug>`.
- Criterios observables: "muestra el mensaje X", no "funciona bien".
