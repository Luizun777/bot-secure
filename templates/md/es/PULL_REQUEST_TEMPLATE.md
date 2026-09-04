## Qué cambia
<!-- Una o dos frases. Enlaza la HU (docs/user-stories/HU-NNNN-*.md) o el ticket. -->

## App(s) tocadas
<!-- {{appNames}} -->

## Checklist
- [ ] Rama de origen `{{branches.taskPrefix}}*` (desde `{{branches.ai}}`) y destino `dev`; sin commits en ramas protegidas.
- [ ] Cero secretos, tokens, connection strings o datos personales reales (RFC/CURP/CLABE/NSS/tarjetas/correos) en el diff, en tests ni en docs.
- [ ] Regla del campo vacío respetada: los campos sensibles de configuración siguen `""`; los valores de IA solo en `.env.ai` (placeholder o fake marcado).
- [ ] Datos de prueba sintéticos (`bot-secure:synthetic`); ningún dump ni fila de producción.
- [ ] `bot-secure scan` sin hallazgos nuevos (o baseline con motivo y revisor).
- [ ] Test del archivo tocado ejecutado; salida real pegada abajo.
- [ ] Docs actualizadas si cambió arquitectura, comandos, convenciones o runbook (`/sync-docs`); ADR si hubo decisión.
- [ ] Lecciones: si un error se repitió, hay 1 línea nueva en `CLAUDE.md` → Lecciones aprendidas o en `docs/LESSONS.md`.

## Evidencia
```text
<!-- salida real del test / comando -->
```
