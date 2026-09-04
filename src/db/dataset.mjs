// Conjunto de datos sintético (una fila por tabla y persona) a partir de synthetic-mx. Determinista por semilla.
import { luhnCheckDigit, person } from '../engine/synthetic-mx.mjs';
import { validateNSS } from '../engine/pii-mx.mjs';

const ROLES = ['cliente', 'cliente', 'cliente', 'cliente', 'soporte', 'admin'];
const ESTATUS = ['pagado', 'pagado', 'enviado', 'pendiente', 'cancelado'];
const METODOS = ['tarjeta', 'transferencia', 'oxxo', 'tarjeta'];
const pad2 = (n) => String(n).padStart(2, '0');

/** Fecha-hora determinista en 2023-2024 con formato 'YYYY-MM-DD HH:MM:SS'. */
function fechaHora(rng) {
  const y = rng.int(2023, 2024), m = rng.int(1, 12), d = rng.int(1, 28);
  return `${y}-${pad2(m)}-${pad2(d)} ${pad2(rng.int(0, 23))}:${pad2(rng.int(0, 59))}:${pad2(rng.int(0, 59))}`;
}

/**
 * NSS aceptado por `validateNSS` de pii-mx. `synthetic-mx.nss()` calcula el año de alta como
 * (nacimiento + 18..25) % 100, que puede caer en el futuro: al resolver los dos dígitos el
 * validador lo lleva a 19xx (< 1943) y lo rechaza. Aquí se reconstruye el mismo NSS con un año de
 * alta pasado, conservando subdelegación y folio (determinista, sin consumir el RNG).
 * @param {string} nss NSS generado por synthetic-mx
 * @param {string} fechaNacimiento ISO YYYY-MM-DD
 * @returns {string} NSS de 11 dígitos válido
 */
export function nssValido(nss, fechaNacimiento) {
  if (validateNSS(nss).valid) return nss;
  const nac = Number(fechaNacimiento.slice(0, 4));
  const hoy = new Date().getUTCFullYear();
  const min = nac + 14, max = Math.max(min, Math.min(nac + 25, hoy));
  const alta = Math.min(Math.max(nac + 18, min), max);
  const base = nss.slice(0, 2) + String(alta % 100).padStart(2, '0') + fechaNacimiento.slice(2, 4) + nss.slice(6, 10);
  return base + luhnCheckDigit(base);
}

/** UUID v4 con forma válida pero derivado del RNG (para uuid_fiscal del CFDI de prueba). */
function uuidFake(rng) {
  const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += rng.int(0, 15).toString(16); return s; };
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rng.int(0, 3)]}${hex(3)}-${hex(12)}`.toUpperCase();
}

/**
 * @typedef {object} Dataset
 * @property {object[]} usuarios
 * @property {object[]} clientes
 * @property {object[]} direcciones
 * @property {object[]} cuentas_bancarias
 * @property {object[]} pedidos
 * @property {object[]} facturas
 * @property {object[]} pagos
 * @property {object[]} auditoria
 */

/**
 * Construye `rows` personas y sus filas relacionadas (1:1 por tabla; ids = 1..rows).
 * @param {number} rows
 * @param {import('../engine/synthetic-mx.mjs').Rng} rng
 * @returns {Dataset}
 */
export function buildDataset(rows, rng) {
  const ds = { usuarios: [], clientes: [], direcciones: [], cuentas_bancarias: [], pedidos: [], facturas: [], pagos: [], auditoria: [] };
  for (let i = 1; i <= rows; i++) {
    const p = person(rng);
    const creado = fechaHora(rng);
    const subtotal = rng.int(100, 20000) + rng.int(0, 99) / 100;
    const iva = Math.round(subtotal * 16) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;
    ds.usuarios.push({ id: i, email: p.email, nombre: `${p.nombre} ${p.apellidos}`, hash_password: '__AI_PLACEHOLDER__PASSWORD_HASH__', rol: rng.pick(ROLES), activo: rng.next() < 0.9, creado_en: creado });
    ds.clientes.push({ id: i, usuario_id: i, nombre: p.nombre, apellido_paterno: p.apellidoPaterno, apellido_materno: p.apellidoMaterno, sexo: p.sexo, fecha_nacimiento: p.fechaNacimiento, rfc: p.rfc, curp: p.curp, nss: nssValido(p.nss, p.fechaNacimiento), telefono: p.telefono, email: p.email, creado_en: creado });
    ds.direcciones.push({ id: i, cliente_id: i, calle: p.direccion.calle, numero: p.direccion.numero, colonia: p.direccion.colonia, cp: p.direccion.cp, municipio: p.direccion.municipio, estado: p.direccion.estado, pais: 'MX' });
    ds.cuentas_bancarias.push({ id: i, cliente_id: i, banco: p.banco, clabe: p.clabe, tarjeta_prueba: p.tarjeta, tarjeta_ultimos4: p.tarjeta.slice(-4), activa: true });
    ds.pedidos.push({ id: i, cliente_id: i, folio: `PED-${String(i).padStart(6, '0')}`, total, moneda: 'MXN', estatus: rng.pick(ESTATUS), creado_en: creado });
    ds.facturas.push({ id: i, pedido_id: i, uuid_fiscal: uuidFake(rng), rfc_receptor: p.rfc, subtotal, iva, total, emitida_en: creado });
    ds.pagos.push({ id: i, factura_id: i, metodo: rng.pick(METODOS), monto: total, referencia: `REF${rng.digits(10)}`, pagado_en: fechaHora(rng) });
    ds.auditoria.push({ id: i, entidad: 'pedidos', entidad_id: i, accion: 'crear', usuario_id: i, detalle: `{"folio":"PED-${String(i).padStart(6, '0')}","origen":"seed-sintetico"}`, creado_en: creado });
  }
  return ds;
}
