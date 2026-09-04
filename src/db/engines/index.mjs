// Registro de motores (imports estáticos: el CLI se despliega empaquetado y no lee del disco).
import mongo from './mongo.mjs';
import mssql from './mssql.mjs';
import mysql from './mysql.mjs';
import oracle from './oracle.mjs';
import postgres from './postgres.mjs';
import redis from './redis.mjs';

/** Motores soportados, en orden de preferencia al detectar. */
export const ENGINES = { postgres, mysql, mongo, redis, mssql, oracle };

/** Nombres de motor soportados. */
export const ENGINE_NAMES = Object.keys(ENGINES);

/** Motor por nombre, o null si no existe. */
export function getEngine(name) { return ENGINES[String(name || '').toLowerCase()] ?? null; }

export { mongo, mssql, mysql, oracle, postgres, redis };
