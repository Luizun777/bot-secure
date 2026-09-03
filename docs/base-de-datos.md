# Base de datos de pruebas en Docker

> Una base de datos real, en un contenedor, con datos inventados que parecen reales. Para que Claude pueda correr migraciones y tests sin acercarse a datos de clientes.

## En tres comandos

```bash
bot-secure db init     # genera mocks/db/ (compose, esquema o migraciones, datos)
bot-secure db up       # levanta el contenedor y carga esquema + datos
bot-secure db status   # motor, puerto, filas cargadas
```
`bot-secure start` ya hace esto por ti. `bot-secure up` es el alias que levanta BD y mocks juntos.

## Qué se genera

```
mocks/db/
├── compose.db.yml            # servicio db, puerto solo en 127.0.0.1, volumen <proyecto>-ai-db, healthcheck
├── init/00-roles.sql         # usuario app con la contraseña de .env.ai (un placeholder literal)
├── schema-generic.<motor>.sql   # si el proyecto no tiene migraciones (o con --generic)
├── migrate.sh                # si el proyecto SÍ tiene migraciones: las ejecuta contra la BD de IA
├── seeds/001-*.sql           # datos sintéticos mexicanos, primera línea: -- bot-secure:synthetic seed=42
└── README.md
```

## Motores

| Motor | Puerto en tu máquina | Detectado por |
|---|---|---|
| PostgreSQL | 127.0.0.1:5433 | `pg`, `psycopg`, `Npgsql`, `application.yml` |
| MySQL / MariaDB | 127.0.0.1:3307 | `mysql2`, `PyMySQL`, `mysql-connector` |
| MongoDB | 127.0.0.1:27018 | `mongoose`, `pymongo` |
| Redis | 127.0.0.1:6380 | `redis`, `ioredis` |
| SQL Server | 127.0.0.1:14330 | `mssql`, `SqlClient` (emulado y lento en Mac ARM) |
| Oracle | 127.0.0.1:15210 | `oracledb`, `ojdbc` (imagen XE; revisa la licencia) |

Puertos distintos a los estándar para no chocar con tu base de desarrollo. Nunca se exponen fuera de `127.0.0.1`.

## Esquema: el tuyo o uno genérico

- Si el bot detecta migraciones (Prisma, TypeORM, knex, Django, Alembic, Flyway, Liquibase, EF Core, Laravel, Rails, goose) las ejecuta contra la BD de IA. Tu esquema, tus tablas.
- Si no hay migraciones, o pasas `--generic`, crea un esquema genérico de negocio: `usuarios`, `clientes`, `direcciones`, `cuentas_bancarias`, `pedidos`, `facturas`, `pagos`, `auditoria`.

## Datos sintéticos mexicanos

Personas y empresas inventadas con RFC, CURP, NSS, CLABE y tarjeta que **pasan los dígitos verificadores** pero no pertenecen a nadie: nombres de listas internas, correos `@ai.local`, teléfonos en rango no asignable, códigos postales reales con su municipio. Son deterministas: `--seed 42` produce siempre los mismos datos, así que `db reset` regenera exactamente lo mismo.

Cada archivo de datos lleva el marcador `bot-secure:synthetic`. El escáner lo reconoce y no reporta esos RFC/CURP como PII real. Si alguien quita el marcador, sí los reporta.

```bash
bot-secure db seed --rows 5000      # más filas
bot-secure db reset                 # borra el volumen y regenera
bot-secure db dump --synthetic      # exporta los datos a mocks/db/seeds/ para CI
```

## Cómo se conecta la app

`.env.ai` ya trae la URL correcta:

```
DATABASE_URL=postgresql://app:__AI_PLACEHOLDER__DB_PASSWORD__@127.0.0.1:5433/app_ai
```
La contraseña del contenedor es literalmente ese placeholder: no es un secreto porque la base solo escucha en tu máquina y solo tiene datos inventados. En tu configuración deja el campo vacío ([regla del campo vacío](stacks.md)).

## Sin Docker

- Con **Podman**, **Colima**, **OrbStack** o **Rancher Desktop** funciona igual (el bot detecta `docker` o `podman`).
- Sin ningún runtime: `bot-secure doctor` lo dice, y en modo `runtime: tests` genera el SQL para que lo cargues en una base local o embebida. Para SQL Server y Oracle no hay alternativa sin contenedor.

## Lo que el bot no hace, a propósito

- **No importa dumps reales.** No existe `db import`. Un dump de producción en el repo se reporta como CRITICAL.
- No expone la BD fuera de tu máquina.
