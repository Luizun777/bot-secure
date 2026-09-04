// Datos sintéticos es_MX deterministas: personas y empresas con identificadores VÁLIDOS por
// checksum (RFC, CURP, NSS, CLABE, tarjeta) pero generados. Nunca corresponden a personas reales.
// Sin dependencias: solo aritmética. Lo usa `db` (seeds) y `pii` (fixtures).

export const SYNTHETIC_MARKER = 'bot-secure:synthetic';

/* ------------------------------------------------------------------------------------------ */
/* PRNG determinista (mulberry32) — misma semilla ⇒ misma secuencia en cualquier plataforma.   */
/* ------------------------------------------------------------------------------------------ */

/**
 * @typedef {object} Rng
 * @property {number} seed semilla original
 * @property {() => number} next flotante en [0,1)
 * @property {(min:number, max:number) => number} int entero en [min,max]
 * @property {<T>(arr:T[]) => T} pick elemento aleatorio
 * @property {(n:number) => string} digits cadena de n dígitos
 */

/** Crea un PRNG determinista a partir de una semilla entera. */
export function createRng(seed = 42) {
  let a = (Number(seed) >>> 0) || 1;
  const next = () => {
    // mulberry32 (Tommy Ettinger, dominio público)
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const digits = (n) => { let s = ''; for (let i = 0; i < n; i++) s += int(0, 9); return s; };
  return { seed: Number(seed), next, int, pick, digits };
}

/* ------------------------------------------------------------------------------------------ */
/* Catálogos internos (pequeños, sin PII real).                                                */
/* ------------------------------------------------------------------------------------------ */

export const NOMBRES_H = [
  'Alejandro', 'Alberto', 'Andrés', 'Antonio', 'Armando', 'Arturo', 'Benjamín', 'Bernardo', 'Carlos', 'César',
  'Cristian', 'Daniel', 'David', 'Diego', 'Eduardo', 'Emilio', 'Enrique', 'Erick', 'Ernesto', 'Esteban',
  'Fabián', 'Federico', 'Felipe', 'Fernando', 'Francisco', 'Gabriel', 'Gerardo', 'Germán', 'Gonzalo', 'Guillermo',
  'Gustavo', 'Héctor', 'Hugo', 'Ignacio', 'Isaac', 'Iván', 'Jaime', 'Javier', 'Jesús', 'Joaquín',
  'Jorge', 'José Luis', 'José Manuel', 'Juan Carlos', 'Juan Pablo', 'Julio', 'Leonardo', 'Lorenzo', 'Luis', 'Manuel',
  'Marco Antonio', 'Mario', 'Martín', 'Mateo', 'Mauricio', 'Miguel Ángel', 'Nicolás', 'Octavio', 'Omar', 'Óscar',
  'Pablo', 'Patricio', 'Pedro', 'Rafael', 'Ramiro', 'Ramón', 'Raúl', 'Ricardo', 'Roberto', 'Rodrigo',
  'Rogelio', 'Rubén', 'Salvador', 'Samuel', 'Santiago', 'Saúl', 'Sebastián', 'Sergio', 'Tomás', 'Uriel',
  'Valentín', 'Víctor', 'Vicente', 'Ulises', 'Adrián', 'Agustín', 'Alfonso', 'Alfredo', 'Ángel', 'Arnulfo',
  'Baltazar', 'Bruno', 'Camilo', 'Cristóbal', 'Damián', 'Darío', 'Efraín', 'Elías', 'Emiliano', 'Fidel',
];

export const NOMBRES_M = [
  'Adriana', 'Alejandra', 'Alicia', 'Alma', 'Ana Laura', 'Ana María', 'Andrea', 'Ángela', 'Araceli', 'Beatriz',
  'Berenice', 'Blanca', 'Brenda', 'Carla', 'Carmen', 'Carolina', 'Catalina', 'Cecilia', 'Claudia', 'Cristina',
  'Daniela', 'Diana', 'Dolores', 'Dulce', 'Elena', 'Elizabeth', 'Elsa', 'Erika', 'Esperanza', 'Estela',
  'Fabiola', 'Fátima', 'Fernanda', 'Gabriela', 'Georgina', 'Gloria', 'Guadalupe', 'Irene', 'Isabel', 'Itzel',
  'Ivonne', 'Jazmín', 'Jimena', 'Josefina', 'Juana', 'Julia', 'Karina', 'Laura', 'Leticia', 'Liliana',
  'Lorena', 'Lourdes', 'Lucía', 'Luz María', 'Magdalena', 'Marcela', 'Margarita', 'María Fernanda', 'María José', 'Mariana',
  'Maribel', 'Marisol', 'Marta', 'Martha', 'Mayra', 'Mercedes', 'Miriam', 'Mónica', 'Nadia', 'Nancy',
  'Natalia', 'Nora', 'Norma', 'Olga', 'Paola', 'Patricia', 'Paulina', 'Pilar', 'Raquel', 'Rebeca',
  'Regina', 'Renata', 'Rocío', 'Rosa', 'Rosario', 'Sandra', 'Silvia', 'Sofía', 'Sonia', 'Susana',
  'Teresa', 'Valeria', 'Vanessa', 'Verónica', 'Victoria', 'Viridiana', 'Ximena', 'Yolanda', 'Yesenia', 'Zaira',
];

export const NOMBRES = [...NOMBRES_H, ...NOMBRES_M];

export const APELLIDOS = [
  'Acosta', 'Aguilar', 'Aguirre', 'Alarcón', 'Alvarado', 'Álvarez', 'Anaya', 'Arellano', 'Arias', 'Ávila',
  'Ayala', 'Baeza', 'Barajas', 'Barrera', 'Bautista', 'Becerra', 'Beltrán', 'Benítez', 'Bravo', 'Briones',
  'Bustamante', 'Caballero', 'Cabrera', 'Calderón', 'Camacho', 'Campos', 'Cano', 'Cárdenas', 'Carrillo', 'Castañeda',
  'Castillo', 'Castro', 'Cervantes', 'Chávez', 'Cisneros', 'Contreras', 'Córdova', 'Cornejo', 'Corona', 'Cortés',
  'Cruz', 'Cuevas', 'Delgado', 'Díaz', 'Domínguez', 'Duarte', 'Durán', 'Escobar', 'Espinoza', 'Esquivel',
  'Estrada', 'Figueroa', 'Flores', 'Franco', 'Fuentes', 'Gallegos', 'Galván', 'Gálvez', 'Gaona', 'García',
  'Garza', 'Gómez', 'González', 'Guerrero', 'Gutiérrez', 'Guzmán', 'Hernández', 'Herrera', 'Hidalgo', 'Huerta',
  'Ibarra', 'Jiménez', 'Juárez', 'Lara', 'Leal', 'León', 'Lira', 'Lozano', 'Luna', 'Macías',
  'Maldonado', 'Márquez', 'Martínez', 'Medina', 'Mejía', 'Mendoza', 'Meza', 'Miranda', 'Molina', 'Montes',
  'Morales', 'Moreno', 'Muñoz', 'Nava', 'Navarro', 'Ochoa', 'Olvera', 'Orozco', 'Ortega', 'Ortiz',
  'Padilla', 'Palacios', 'Peña', 'Pérez', 'Pineda', 'Quintero', 'Ramírez', 'Ramos', 'Reyes', 'Ríos',
  'Rivera', 'Robles', 'Rodríguez', 'Rojas', 'Romero', 'Rosales', 'Ruiz', 'Salazar', 'Salinas', 'Sánchez',
  'Sandoval', 'Santiago', 'Serrano', 'Solís', 'Soto', 'Tapia', 'Torres', 'Treviño', 'Valdez', 'Valencia',
  'Vargas', 'Vázquez', 'Vega', 'Velázquez', 'Villanueva', 'Villarreal', 'Zamora', 'Zapata', 'Zavala', 'Zúñiga',
];

const CALLES = [
  'Av. Insurgentes Sur', 'Calle Reforma', 'Av. Juárez', 'Calle Hidalgo', 'Av. Revolución', 'Calle Morelos', 'Av. Universidad',
  'Calle Allende', 'Av. Patriotismo', 'Calle Madero', 'Av. Constituyentes', 'Calle Zaragoza', 'Av. Chapultepec', 'Calle 5 de Mayo',
  'Av. Vallarta', 'Calle Aldama', 'Av. Independencia', 'Calle Guerrero', 'Av. López Mateos', 'Calle Matamoros',
];

/**
 * Códigos postales reales (SEPOMEX) con colonia, municipio, estado y clave de entidad (RENAPO) para la CURP.
 * Catálogo pequeño: uno por entidad federativa (32 entradas + CDMX repetida con colonia distinta).
 */
export const CP_MX = [
  { cp: '06600', colonia: 'Juárez', municipio: 'Cuauhtémoc', estado: 'Ciudad de México', entidad: 'DF' },
  { cp: '03100', colonia: 'Del Valle Centro', municipio: 'Benito Juárez', estado: 'Ciudad de México', entidad: 'DF' },
  { cp: '20000', colonia: 'Zona Centro', municipio: 'Aguascalientes', estado: 'Aguascalientes', entidad: 'AS' },
  { cp: '22000', colonia: 'Zona Centro', municipio: 'Tijuana', estado: 'Baja California', entidad: 'BC' },
  { cp: '23000', colonia: 'Centro', municipio: 'La Paz', estado: 'Baja California Sur', entidad: 'BS' },
  { cp: '24000', colonia: 'Centro', municipio: 'Campeche', estado: 'Campeche', entidad: 'CC' },
  { cp: '25000', colonia: 'Centro', municipio: 'Saltillo', estado: 'Coahuila de Zaragoza', entidad: 'CL' },
  { cp: '28000', colonia: 'Centro', municipio: 'Colima', estado: 'Colima', entidad: 'CM' },
  { cp: '29000', colonia: 'Centro', municipio: 'Tuxtla Gutiérrez', estado: 'Chiapas', entidad: 'CS' },
  { cp: '31000', colonia: 'Centro', municipio: 'Chihuahua', estado: 'Chihuahua', entidad: 'CH' },
  { cp: '34000', colonia: 'Zona Centro', municipio: 'Durango', estado: 'Durango', entidad: 'DG' },
  { cp: '37000', colonia: 'Centro', municipio: 'León', estado: 'Guanajuato', entidad: 'GT' },
  { cp: '39000', colonia: 'Centro', municipio: 'Chilpancingo de los Bravo', estado: 'Guerrero', entidad: 'GR' },
  { cp: '42000', colonia: 'Centro', municipio: 'Pachuca de Soto', estado: 'Hidalgo', entidad: 'HG' },
  { cp: '44100', colonia: 'Guadalajara Centro', municipio: 'Guadalajara', estado: 'Jalisco', entidad: 'JC' },
  { cp: '50000', colonia: 'Centro', municipio: 'Toluca', estado: 'Estado de México', entidad: 'MC' },
  { cp: '58000', colonia: 'Centro', municipio: 'Morelia', estado: 'Michoacán de Ocampo', entidad: 'MN' },
  { cp: '62000', colonia: 'Centro', municipio: 'Cuernavaca', estado: 'Morelos', entidad: 'MS' },
  { cp: '63000', colonia: 'Centro', municipio: 'Tepic', estado: 'Nayarit', entidad: 'NT' },
  { cp: '64000', colonia: 'Monterrey Centro', municipio: 'Monterrey', estado: 'Nuevo León', entidad: 'NL' },
  { cp: '68000', colonia: 'Centro', municipio: 'Oaxaca de Juárez', estado: 'Oaxaca', entidad: 'OC' },
  { cp: '72000', colonia: 'Centro', municipio: 'Puebla', estado: 'Puebla', entidad: 'PL' },
  { cp: '76000', colonia: 'Centro', municipio: 'Querétaro', estado: 'Querétaro', entidad: 'QT' },
  { cp: '77500', colonia: 'Cancún Centro', municipio: 'Benito Juárez', estado: 'Quintana Roo', entidad: 'QR' },
  { cp: '78000', colonia: 'Centro', municipio: 'San Luis Potosí', estado: 'San Luis Potosí', entidad: 'SP' },
  { cp: '80000', colonia: 'Centro', municipio: 'Culiacán', estado: 'Sinaloa', entidad: 'SL' },
  { cp: '83000', colonia: 'Centro', municipio: 'Hermosillo', estado: 'Sonora', entidad: 'SR' },
  { cp: '86000', colonia: 'Centro', municipio: 'Villahermosa', estado: 'Tabasco', entidad: 'TC' },
  { cp: '87000', colonia: 'Centro', municipio: 'Ciudad Victoria', estado: 'Tamaulipas', entidad: 'TS' },
  { cp: '90000', colonia: 'Centro', municipio: 'Tlaxcala', estado: 'Tlaxcala', entidad: 'TL' },
  { cp: '91000', colonia: 'Centro', municipio: 'Xalapa', estado: 'Veracruz de Ignacio de la Llave', entidad: 'VZ' },
  { cp: '97000', colonia: 'Centro', municipio: 'Mérida', estado: 'Yucatán', entidad: 'YN' },
  { cp: '98000', colonia: 'Centro', municipio: 'Zacatecas', estado: 'Zacatecas', entidad: 'ZS' },
];

/** Claves de entidad federativa válidas en la CURP (RENAPO), incluida NE = nacido en el extranjero. */
export const ENTIDADES_CURP = ['AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR', 'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'NE'];

/** Bancos del catálogo de Banxico (clave de 3 dígitos usada en la CLABE) — solo instituciones reales y vigentes. */
export const BANCOS_MX = [
  { clave: '002', nombre: 'BANAMEX' }, { clave: '012', nombre: 'BBVA MEXICO' }, { clave: '014', nombre: 'SANTANDER' },
  { clave: '021', nombre: 'HSBC' }, { clave: '030', nombre: 'BAJIO' }, { clave: '036', nombre: 'INBURSA' },
  { clave: '044', nombre: 'SCOTIABANK' }, { clave: '058', nombre: 'BANREGIO' }, { clave: '072', nombre: 'BANORTE' },
  { clave: '127', nombre: 'AZTECA' }, { clave: '137', nombre: 'BANCOPPEL' }, { clave: '646', nombre: 'STP' },
];

/** Plazas Banxico (3 dígitos, posiciones 4-6 de la CLABE). */
export const PLAZAS_MX = ['010', '180', '580', '320', '540', '150', '340', '910'];

/* ------------------------------------------------------------------------------------------ */
/* Normalización de nombres para RFC/CURP.                                                    */
/* ------------------------------------------------------------------------------------------ */

const PREPOSICIONES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'MC', 'MAC', 'VON', 'VAN']);
const NOMBRES_COMUNES = new Set(['JOSE', 'MARIA', 'J', 'MA', 'MA.']);
// Palabras inconvenientes (Anexo RENAPO / SAT): se sustituye una letra por X.
const INCONVENIENTES = new Set(('BACA BAKA BUEI BUEY CACA CACO CAGA CAGO CAKA CAKO COGE COGI COJA COJE COJI COJO COLA CULO FALO FETO GETA GUEI GUEY JETA JOTO KACA KACO KAGA KAGO KAKA KAKO KOGE KOGI KOJA KOJE KOJI KOJO KOLA KULO LILO LOCA LOCO LOKA LOKO MAME MAMO MEAR MEAS MEON MIAR MION MOCO MOKO MULA MULO NACA NACO PEDA PEDO PENE PIPI PITO POPO PUTA PUTO QULO RATA ROBA ROBE ROBO RUIN SENO TETA VACA VAGA VAGO VAKA VUEI VUEY WUEI WUEY').split(' '));

/** Mayúsculas sin acentos; Ñ → X (regla RENAPO; el SAT también la acepta en la práctica). */
export function normalizeName(s) {
  return String(s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .replace(/Ñ/g, 'X').replace(/[^A-Z &.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Quita preposiciones ("DE LA CRUZ" → "CRUZ") y para nombres compuestos que empiezan con JOSE/MARIA usa el segundo. */
function keyWord(fullName, { dropCommon = false } = {}) {
  const words = normalizeName(fullName).split(' ').filter((w) => w && !PREPOSICIONES.has(w));
  if (dropCommon && words.length > 1 && NOMBRES_COMUNES.has(words[0])) words.shift();
  return words[0] || 'X';
}

const firstInnerVowel = (w) => (w.slice(1).match(/[AEIOU]/) || ['X'])[0];
const innerConsonant = (w) => (w.slice(1).match(/[BCDFGHJKLMNPQRSTVWXYZ]/) || ['X'])[0];

/* ------------------------------------------------------------------------------------------ */
/* RFC (SAT). Fuente: "Algoritmo para la generación del RFC con homoclave" (anexo SAT/CONTPAQ).*/
/* ------------------------------------------------------------------------------------------ */

// Tabla de la homoclave: cada carácter del nombre completo se convierte a 2 dígitos.
const HOMOCLAVE_TABLA = {
  ' ': '00', '0': '00', '1': '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06', '7': '07', '8': '08', '9': '09',
  '&': '10', 'A': '11', 'B': '12', 'C': '13', 'D': '14', 'E': '15', 'F': '16', 'G': '17', 'H': '18', 'I': '19', 'J': '21',
  'K': '22', 'L': '23', 'M': '24', 'N': '25', 'O': '26', 'P': '27', 'Q': '28', 'R': '29', 'S': '32', 'T': '33', 'U': '34',
  'V': '35', 'W': '36', 'X': '37', 'Y': '38', 'Z': '39', 'Ñ': '40',
};
const HOMOCLAVE_SALIDA = '123456789ABCDEFGHIJKLMNPQRSTUVWXYZ'; // 34 símbolos (sin 0 ni O)
// Tabla del dígito verificador: el índice es el valor del carácter (espacio = 37, Ñ = 38).
const DV_TABLA = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

/**
 * Homoclave SAT (2 caracteres). Algoritmo: se antepone '0' a la cadena de códigos de 2 dígitos del
 * nombre completo; se suman los productos (número formado por cada par de dígitos consecutivos) ×
 * (segundo dígito del par); del resultado se toman los 3 últimos dígitos, se dividen entre 34:
 * cociente y residuo indexan la tabla de salida.
 */
export function rfcHomoclave(fullName) {
  let s = '0';
  for (const ch of normalizeName(fullName)) s += HOMOCLAVE_TABLA[ch] ?? '00';
  let sum = 0;
  for (let i = 0; i < s.length - 1; i++) sum += Number(s.slice(i, i + 2)) * Number(s[i + 1]);
  const mod = sum % 1000;
  return HOMOCLAVE_SALIDA[Math.floor(mod / 34)] + HOMOCLAVE_SALIDA[mod % 34];
}

/**
 * Dígito verificador del RFC (mod 11). Física: 12 caracteres con pesos 13..2. Moral: se antepone un
 * espacio (valor 37) a los 11 caracteres para usar los mismos pesos (verificado con SAT970701NN3).
 */
export function rfcCheckDigit(rfcSinDigito) {
  const s = rfcSinDigito.length === 11 ? ' ' + rfcSinDigito : rfcSinDigito;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += DV_TABLA.indexOf(s[i]) * (13 - i);
  const mod = sum % 11;
  if (mod === 0) return '0';
  const d = 11 - mod;
  return d === 10 ? 'A' : String(d);
}

const yymmdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

/** RFC de persona física (13). */
export function rfcFisica({ nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento }) {
  const p = keyWord(apellidoPaterno), m = apellidoMaterno ? keyWord(apellidoMaterno) : '', n = keyWord(nombre, { dropCommon: true });
  let letras;
  if (!m) letras = (p.slice(0, 2) + n.slice(0, 2)).padEnd(4, 'X');
  else if (p.length < 3) letras = p[0] + m[0] + n.slice(0, 2);
  else letras = p[0] + firstInnerVowel(p) + m[0] + n[0];
  if (INCONVENIENTES.has(letras)) letras = letras.slice(0, 3) + 'X';
  const base = letras + yymmdd(fechaNacimiento) + rfcHomoclave(`${apellidoPaterno} ${apellidoMaterno ?? ''} ${nombre}`);
  return base + rfcCheckDigit(base);
}

const MORAL_IGNORAR = new Set(['SA', 'DE', 'CV', 'SRL', 'SAPI', 'SC', 'AC', 'S', 'A', 'C', 'V', 'R', 'L', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'DEL', 'EN', 'CON', 'PARA', 'POR', 'AL', 'E', 'COMPAÑIA', 'COMPANIA', 'CIA', 'SOCIEDAD', 'ANONIMA', 'THE', 'AND', 'OF', 'MC', 'MI']);

/** RFC de persona moral (12): 3 letras de la razón social + fecha de constitución + homoclave + dígito. */
export function rfcMoral(razonSocial, fechaConstitucion) {
  const words = normalizeName(razonSocial.replace(/\./g, '')).split(' ').filter((w) => w && !MORAL_IGNORAR.has(w));
  let letras;
  if (words.length >= 3) letras = words[0][0] + words[1][0] + words[2][0];
  else if (words.length === 2) letras = words[0][0] + words[1].slice(0, 2);
  else letras = (words[0] || 'XXX').slice(0, 3);
  letras = letras.padEnd(3, 'X');
  const base = letras + yymmdd(fechaConstitucion) + rfcHomoclave(razonSocial.replace(/\./g, ''));
  return base + rfcCheckDigit(base);
}

/* ------------------------------------------------------------------------------------------ */
/* CURP (RENAPO). Fuente: Instructivo normativo para la asignación de la CURP (DOF).           */
/* ------------------------------------------------------------------------------------------ */

const CURP_TABLA = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/** Dígito verificador de la CURP: Σ valor(c_i) × (18 − i), i = 0..16; dígito = (10 − Σ mod 10) mod 10. */
export function curpCheckDigit(curp17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += CURP_TABLA.indexOf(curp17[i]) * (18 - i);
  return String((10 - (sum % 10)) % 10);
}

/** CURP (18). `homonimia` es el carácter 17 (dígito si nació antes de 2000, letra si después). */
export function curp({ nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, sexo, entidad }, homonimia) {
  const p = keyWord(apellidoPaterno), m = apellidoMaterno ? keyWord(apellidoMaterno) : 'X', n = keyWord(nombre, { dropCommon: true });
  let letras = p[0] + firstInnerVowel(p) + m[0] + n[0];
  if (INCONVENIENTES.has(letras)) letras = letras[0] + 'X' + letras.slice(2);
  const year = Number(fechaNacimiento.slice(0, 4));
  const h = homonimia ?? (year < 2000 ? '0' : 'A');
  const base = letras + yymmdd(fechaNacimiento) + (sexo === 'M' ? 'M' : 'H') + entidad
    + innerConsonant(p) + innerConsonant(m) + innerConsonant(n) + h;
  return base + curpCheckDigit(base);
}

/* ------------------------------------------------------------------------------------------ */
/* Luhn (NSS y tarjetas), CLABE (Banxico).                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Dígito de control Luhn (ISO/IEC 7812) para una cadena de dígitos sin el dígito final. */
export function luhnCheckDigit(digits) {
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/** ¿Pasa Luhn la cadena completa (con dígito)? */
export function luhnValid(s) { return /^\d{2,}$/.test(s) && luhnCheckDigit(s.slice(0, -1)) === s.slice(-1); }

/**
 * Dígito de control de la CLABE (Banxico, 18 dígitos): pesos 3,7,1 cíclicos sobre los 17 primeros,
 * se suma (d×peso) mod 10 y el dígito es (10 − Σ mod 10) mod 10.
 */
export function clabeCheckDigit(clabe17) {
  const pesos = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(clabe17[i]) * pesos[i % 3]) % 10;
  return String((10 - (sum % 10)) % 10);
}

/**
 * NSS (IMSS, 11 dígitos): 2 subdelegación + 2 año de alta + 2 año de nacimiento + 4 folio + Luhn.
 */
export function nss(rng, fechaNacimiento) {
  const yyNac = fechaNacimiento.slice(2, 4);
  const yyAlta = String((Number(fechaNacimiento.slice(0, 4)) + rng.int(18, 25)) % 100).padStart(2, '0');
  const sub = String(rng.int(1, 60)).padStart(2, '0');
  const base = sub + yyAlta + yyNac + rng.digits(4);
  return base + luhnCheckDigit(base);
}

/** CLABE con banco real del catálogo y plaza Banxico. */
export function clabe(rng) {
  const banco = rng.pick(BANCOS_MX);
  const base = banco.clave + rng.pick(PLAZAS_MX) + rng.digits(11);
  return { clabe: base + clabeCheckDigit(base), banco: banco.nombre };
}

/** Tarjeta de 16 dígitos con IIN de prueba (4111 11 Visa / 5555 55 Mastercard) y Luhn válido. */
export function tarjeta(rng) {
  const base = rng.pick(['411111', '555555']) + rng.digits(9);
  return base + luhnCheckDigit(base);
}

/* ------------------------------------------------------------------------------------------ */
/* Persona y empresa.                                                                          */
/* ------------------------------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, '0');
function fechaAleatoria(rng, yMin, yMax) {
  const y = rng.int(yMin, yMax), m = rng.int(1, 12);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad2(m)}-${pad2(rng.int(1, dim))}`;
}
const slugHost = (s) => normalizeName(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const slug = (s) => normalizeName(s).toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

/**
 * @typedef {object} Persona
 * @property {string} nombre
 * @property {string} apellidoPaterno
 * @property {string} apellidoMaterno
 * @property {string} apellidos "Paterno Materno" (alias del contrato)
 * @property {'H'|'M'} sexo
 * @property {string} fechaNacimiento ISO YYYY-MM-DD
 * @property {string} rfc 13 caracteres
 * @property {string} curp 18 caracteres
 * @property {string} nss 11 dígitos
 * @property {string} clabe 18 dígitos
 * @property {string} banco
 * @property {string} tarjeta 16 dígitos (IIN de prueba)
 * @property {string} email @ai.local
 * @property {string} telefono +52 55 0000 XXXX (rango no asignable)
 * @property {{calle:string, numero:string, colonia:string, cp:string, municipio:string, estado:string}} direccion
 */

/** Genera una persona sintética determinista a partir del RNG. */
export function person(rng) {
  const sexo = rng.next() < 0.5 ? 'H' : 'M';
  const nombre = rng.pick(sexo === 'H' ? NOMBRES_H : NOMBRES_M);
  const apellidoPaterno = rng.pick(APELLIDOS), apellidoMaterno = rng.pick(APELLIDOS);
  const fechaNacimiento = fechaAleatoria(rng, 1955, 2005);
  const lugar = rng.pick(CP_MX);
  const year = Number(fechaNacimiento.slice(0, 4));
  const homonimia = year < 2000 ? String(rng.int(0, 9)) : String.fromCharCode(65 + rng.int(0, 25));
  const datos = { nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, sexo, entidad: lugar.entidad };
  const cuenta = clabe(rng);
  const serial = rng.int(1, 999);
  return {
    nombre, apellidoPaterno, apellidoMaterno, apellidos: `${apellidoPaterno} ${apellidoMaterno}`, sexo, fechaNacimiento,
    rfc: rfcFisica(datos),
    curp: curp(datos, homonimia),
    nss: nss(rng, fechaNacimiento),
    clabe: cuenta.clabe, banco: cuenta.banco,
    tarjeta: tarjeta(rng),
    email: `${slug(nombre)}.${slug(apellidoPaterno)}${serial}@ai.local`,
    telefono: `+52 55 0000 ${rng.digits(4)}`,
    direccion: {
      calle: rng.pick(CALLES), numero: String(rng.int(1, 999)), colonia: lugar.colonia, cp: lugar.cp,
      municipio: lugar.municipio, estado: lugar.estado,
    },
  };
}

const GIROS = ['Comercializadora', 'Distribuidora', 'Servicios', 'Consultoría', 'Constructora', 'Tecnología', 'Logística', 'Alimentos', 'Textiles', 'Transportes'];
const NOMBRES_EMPRESA = ['del Bajío', 'Azteca', 'del Norte', 'Maya', 'Peninsular', 'Mexicana', 'del Centro', 'Tolteca', 'del Golfo', 'Pacífico', 'Sierra Madre', 'Nopal', 'Quetzal', 'Jaguar', 'Colibrí'];
const SUFIJOS = ['S.A. de C.V.', 'S. de R.L. de C.V.', 'S.A.P.I. de C.V.'];

/** Empresa sintética con RFC moral (12) válido. */
export function company(rng) {
  const giro = rng.pick(GIROS), nombre = rng.pick(NOMBRES_EMPRESA), sufijo = rng.pick(SUFIJOS);
  const razonSocial = `${giro} ${nombre} ${sufijo}`;
  const fechaConstitucion = fechaAleatoria(rng, 1985, 2020);
  const lugar = rng.pick(CP_MX);
  const cuenta = clabe(rng);
  return {
    razonSocial, fechaConstitucion,
    rfc: rfcMoral(`${giro} ${nombre}`, fechaConstitucion),
    clabe: cuenta.clabe, banco: cuenta.banco,
    email: `facturacion@${slugHost(giro)}-${slugHost(nombre)}.ai.local`,
    telefono: `+52 55 0000 ${rng.digits(4)}`,
    direccion: { calle: rng.pick(CALLES), numero: String(rng.int(1, 999)), colonia: lugar.colonia, cp: lugar.cp, municipio: lugar.municipio, estado: lugar.estado },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Marcador para que el escáner no reporte los datos sintéticos.                               */
/* ------------------------------------------------------------------------------------------ */

const COMMENT_STYLES = { sql: '--', '--': '--', shell: '#', sh: '#', '#': '#', yaml: '#', js: '//', '//': '//', mongo: '//' };

/**
 * Línea de cabecera con el marcador, p. ej. `-- bot-secure:synthetic seed=42`.
 * @param {string} commentStyle '--' | '#' | '//' (o alias sql|shell|js)
 * @param {{seed?:number, rows?:number}} [meta]
 */
export function markerHeader(commentStyle = '--', { seed, rows } = {}) {
  const prefix = COMMENT_STYLES[commentStyle] ?? commentStyle;
  const extra = [seed !== undefined ? `seed=${seed}` : '', rows !== undefined ? `rows=${rows}` : ''].filter(Boolean).join(' ');
  return `${prefix} ${SYNTHETIC_MARKER}${extra ? ' ' + extra : ''}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Validadores locales (mismos algoritmos) — los usa el test si aún no existe pii-mx.mjs.      */
/* ------------------------------------------------------------------------------------------ */

export const validators = {
  rfc: (s) => (/^[A-Z&]{3,4}\d{6}[A-Z0-9]{2}[0-9A]$/.test(s) && rfcCheckDigit(s.slice(0, -1)) === s.slice(-1)),
  curp: (s) => (/^[A-Z]{4}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/.test(s) && ENTIDADES_CURP.includes(s.slice(11, 13)) && curpCheckDigit(s.slice(0, 17)) === s.slice(17)),
  nss: (s) => /^\d{11}$/.test(s) && luhnValid(s),
  clabe: (s) => /^\d{18}$/.test(s) && BANCOS_MX.some((b) => b.clave === s.slice(0, 3)) && clabeCheckDigit(s.slice(0, 17)) === s.slice(17),
  tarjeta: (s) => /^\d{16}$/.test(s) && luhnValid(s),
};
