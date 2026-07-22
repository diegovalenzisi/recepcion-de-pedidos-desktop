// ---------------------------------------------------------------------------
// FIXTURES CANÓNICOS — contrato común entre Desktop, Tablet y DLV Pedidos.
//
// Este archivo es DATOS, no lógica. Debe ser byte a byte idéntico en los tres
// repositorios: paridadCanonica.test.js falla si una copia cambia sin que
// cambien las demás, y CONTRATO_VERSION identifica la versión del contrato.
//
// Cada caso declara entradas en forma CANÓNICA (valor / selectedOptionals).
// Cada proyecto lo ejecuta por SU camino real: Desktop y Tablet directo, DLV
// traduciendo con su adaptador. El resultado esperado es el mismo en los tres.
//
// Regla: NO se cambian los valores esperados para hacer pasar una prueba.
// ---------------------------------------------------------------------------

export const CONTRATO_VERSION = '1.0.0';

const KILO = { id: 'A-0007', nombre: '1 KILO DE HELADO', valor: 14500 };
const AGUA = { id: 'A-0099', nombre: 'AGUA', valor: 1200 };

const ROCKLETS = { id: 'O-40', nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING', numeroOrden: 1 };
const OREO = { id: 'O-41', nombre: 'Oreo', precio: 900, grupoNombre: 'TOPPING', numeroOrden: 2 };
const SALSA_GRATIS = { id: 'O-50', nombre: 'Salsa de chocolate', precio: 0, grupoNombre: 'SALSA', numeroOrden: 1 };
const CHOCOLATE = { id: 'O-11', nombre: 'Chocolate', precio: 0, grupoNombre: 'SABORES', numeroOrden: 1 };
const FRUTILLA = { id: 'O-13', nombre: 'Frutilla', precio: 0, grupoNombre: 'SABORES', numeroOrden: 2 };

const unidad = (opcionales, uniqueId, unidadIndice, unidadTotal) => ({
  ...KILO, quantity: 1, uniqueId, unidadIndice, unidadTotal,
  ...(opcionales ? { selectedOptionals: opcionales } : {}),
});

/**
 * Cada caso:
 *   nombre        — identificador estable del caso (mismo texto en los 3)
 *   items         — líneas del pedido en forma canónica
 *   totalEsperado — importe exacto esperado (null = no se evalúa el total)
 *   comprobar     — qué debe verificarse además del total
 */
export const CASOS = [
  {
    nombre: '01 base sin opcional',
    items: [{ ...KILO, quantity: 1, uniqueId: 'u1' }],
    totalEsperado: 14500,
  },
  {
    nombre: '02 base + Rocklets',
    items: [unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { precioBaseUnitario: 14500, totalOpcionales: 1700, subtotalLinea: 16200 },
  },
  {
    nombre: '03 quitar Rocklets',
    items: [unidad({ 'G-TOPPING': [] }, 'u1', 1, 1)],
    totalEsperado: 14500,
    comprobar: { totalOpcionales: 0, subtotalLinea: 14500 },
  },
  {
    nombre: '04 dos opciones pagas',
    items: [unidad({ 'G-TOPPING': [ROCKLETS, OREO] }, 'u1', 1, 1)],
    totalEsperado: 17100,
    comprobar: { totalOpcionales: 2600, subtotalLinea: 17100 },
  },
  {
    nombre: '05 opcional gratuito',
    items: [unidad({ 'G-SALSA': [SALSA_GRATIS] }, 'u1', 1, 1)],
    totalEsperado: 14500,
    comprobar: { totalOpcionales: 0, subtotalLinea: 14500 },
  },
  {
    nombre: '06 precio invalido',
    items: [unidad({ 'G-TOPPING': [{ ...ROCKLETS, precio: 'abc' }] }, 'u1', 1, 1)],
    totalEsperado: 14500,
    comprobar: { invalidos: 1, totalOpcionales: 0 },
  },
  {
    nombre: '07 precio como string "1700"',
    items: [unidad({ 'G-TOPPING': [{ ...ROCKLETS, precio: '1700' }] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { totalOpcionales: 1700, invalidos: 0 },
  },
  {
    nombre: '08 precio historico "$ 1.700,00"',
    items: [unidad({ 'G-TOPPING': [{ ...ROCKLETS, precio: '$ 1.700,00' }] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { totalOpcionales: 1700, invalidos: 0 },
  },
  {
    nombre: '09 dos unidades, Rocklets solo en la primera',
    items: [
      unidad({ 'G-SABORES': [CHOCOLATE], 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 2),
      unidad({ 'G-SABORES': [FRUTILLA] }, 'u2', 2, 2),
    ],
    totalEsperado: 30700,
    comprobar: { subtotales: [16200, 14500], unidades: ['1/2', '2/2'] },
  },
  {
    nombre: '10 dos unidades, Rocklets en ambas',
    items: [
      unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 2),
      unidad({ 'G-TOPPING': [ROCKLETS] }, 'u2', 2, 2),
    ],
    totalEsperado: 32400,
    comprobar: { subtotales: [16200, 16200] },
  },
  {
    nombre: '11 snapshot congelado',
    // El subtotal guardado manda: aunque el catálogo cambie, no se recalcula.
    items: [{
      ...KILO, quantity: 1, uniqueId: 'u1',
      selectedOptionals: { 'G-TOPPING': [{ ...ROCKLETS, precioUnitario: 1700, cantidad: 1, total: 1700 }] },
      precioBaseUnitario: 14500, totalOpcionales: 1700, subtotalLinea: 16200,
      opcionalesIncluidosEnValor: false,
    }],
    totalEsperado: 16200,
    comprobar: { subtotalLinea: 16200 },
  },
  {
    nombre: '12 opcionalesIncluidosEnValor=true',
    // `valor` ya trae el adicional adentro: NO se puede volver a sumar.
    items: [{
      ...KILO, valor: 16200, quantity: 1, uniqueId: 'u1',
      selectedOptionals: { 'G-TOPPING': [ROCKLETS] },
      opcionalesIncluidosEnValor: true,
    }],
    totalEsperado: 16200,
  },
  {
    nombre: '13 historico sin precio en el opcional',
    items: [{
      ...KILO, quantity: 1, uniqueId: 'u1',
      selectedOptionals: { 'G-TOPPING': [{ nombre: 'Rocklets' }] },
    }],
    totalEsperado: 14500,
    comprobar: { invalidos: 0, nombreOpcional: 'Rocklets' },
  },
  {
    nombre: '14 promocion con Rocklets solo en un hijo',
    items: [{
      id: 'A-0500', nombre: 'PROMO 2 KILOS', valor: 25000, quantity: 1, uniqueId: 'p1', isPromo: true,
      promoItems: [
        { id: 'A-0007', nombre: 'KILO 1', quantity: 1, cantidad: 1, selectedOptionals: { 'G-TOPPING': [ROCKLETS] } },
        { id: 'A-0007', nombre: 'KILO 2', quantity: 1, cantidad: 1, selectedOptionals: { 'G-SALSA': [SALSA_GRATIS] } },
      ],
    }],
    // El adicional del hijo vive en el hijo; el precio del combo es el del combo.
    totalEsperado: 25000,
    comprobar: { hijoConRocklets: 0, precioOpcionalHijo: 1700 },
  },
  {
    nombre: '15 serializar y releer',
    items: [unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { serializar: true },
  },
  {
    nombre: '16 editar sin cambios',
    items: [unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { reguardar: 1 },
  },
  {
    nombre: '17 total visual manipulado',
    items: [unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { totalRecibidoFalso: 14500 },
  },
  {
    nombre: '18 cinco ciclos de serializacion',
    items: [unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 1)],
    totalEsperado: 16200,
    comprobar: { reguardar: 5 },
  },
  {
    nombre: '19 mismo opcional en dos grupos distintos',
    // Rocklets aparece en TOPPING y en EXTRAS: son dos adicionales, no uno.
    items: [unidad({
      'G-TOPPING': [ROCKLETS],
      'G-EXTRAS': [{ ...ROCKLETS, grupoNombre: 'EXTRAS' }],
    }, 'u1', 1, 1)],
    totalEsperado: 17900,
    comprobar: { totalOpcionales: 3400, gruposConOpcionales: 2 },
  },
  {
    nombre: '20 dos lineas con configuracion identica no se fusionan',
    items: [
      unidad({ 'G-TOPPING': [ROCKLETS] }, 'u1', 1, 2),
      unidad({ 'G-TOPPING': [ROCKLETS] }, 'u2', 2, 2),
    ],
    totalEsperado: 32400,
    comprobar: { lineas: 2, uniqueIds: ['u1', 'u2'], quantities: [1, 1] },
  },
  {
    nombre: '21 producto sin opcionales si puede agruparse',
    items: [{ ...AGUA, quantity: 3, uniqueId: 'a1' }],
    totalEsperado: 3600,
    comprobar: { lineas: 1, quantities: [3], sinUnidad: true },
  },
];
