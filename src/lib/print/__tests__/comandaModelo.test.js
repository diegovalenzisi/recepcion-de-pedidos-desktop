// COMANDA — título real de cada grupo y unidades idénticas vs. distintas.
//
// El caso que originó todo esto: el pedido 4021 de Achaval, cargado desde DLV
// Pedidos, imprimía "OPCIONALES" donde la carga manual imprime "SABORES" y
// "SALSAS". El fixture `PEDIDO_4021` reproduce su estructura EXACTA (ids,
// campos y anidamiento reales), con los nombres de las opciones cambiados: no
// hace falta ningún dato real para reproducir el bug.
//
// Correr:  node src/lib/print/__tests__/comandaModelo.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TITULO_GRUPO_POR_DEFECTO,
  bloquesDeComanda,
  esUnidadConfigurada,
  gruposDeOpcionales,
  idsCandidatos,
  resolverTituloGrupo,
} from '../comandaModelo.js';
import { generateOptionalsHtml } from '../utils.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

// Catálogo REAL de un local (forma exacta de /{localId}/GRUPOS_OPCIONALES).
const CATALOGO = [
  { id: '1G', nombre: 'SABORES', ordenLocal: 0 },
  { id: '2G', nombre: 'SALSAS', ordenLocal: 1 },
  { id: '3G', nombre: 'CAFETERIA', ordenLocal: 2 },
];

const op = (nombre, over = {}) => ({
  nombre, name: nombre, cantidad: 1, quantity: 1, precio: 0, precioUnitario: 0, ...over,
});

// ── Cómo guarda cada origen el MISMO pedido ─────────────────────────────────
// Manual  → id del catálogo: "1G"
// DLV     → id compuesto por artículo: "group-81A-1G"  (no existe en catálogo)
const unidadManual = (sabores, salsa, over = {}) => ({
  id: '81A', nombre: '1/4 KILO DE HELADO', quantity: 1, valor: 5500, precioBaseUnitario: 5500,
  selectedOptionals: {
    '1G': sabores.map((s) => op(s, { grupoId: '1G', grupoNombre: 'SABORES' })),
    ...(salsa ? { '2G': [op(salsa, { grupoId: '2G', grupoNombre: 'SALSAS' })] } : {}),
  },
  ...over,
});

const unidadDlv = (sabores, salsa, over = {}) => ({
  id: '81A', nombre: '1/4 KILO DE HELADO', quantity: 1, valor: 5500, precioBaseUnitario: 5500,
  selectedOptionals: {
    'group-81A-1G': sabores.map((s) => op(s, { grupoId: 'group-81A-1G', grupoNombre: 'SABORES' })),
    ...(salsa ? { 'group-81A-2G': [op(salsa, { grupoId: 'group-81A-2G', grupoNombre: 'SALSAS' })] } : {}),
  },
  ...over,
});

console.log('\nTítulo real de cada grupo:');

check('grupo SABORES: manual y DLV dan el MISMO título', () => {
  const m = gruposDeOpcionales(unidadManual(['Chocolate']).selectedOptionals, CATALOGO);
  const d = gruposDeOpcionales(unidadDlv(['Chocolate']).selectedOptionals, CATALOGO);
  assert.strictEqual(m[0].nombreGrupo, 'SABORES');
  assert.strictEqual(d[0].nombreGrupo, 'SABORES');
  assert.strictEqual(m[0].origenTitulo, 'catalogo');
  assert.strictEqual(d[0].origenTitulo, 'catalogo-id-normalizado');
});
check('grupo SALSAS: manual y DLV dan el MISMO título', () => {
  const d = gruposDeOpcionales(unidadDlv([], 'Frutilla').selectedOptionals, CATALOGO);
  assert.strictEqual(d[0].nombreGrupo, 'SALSAS');
});
check('artículo con SABORES y SALSAS conserva los DOS títulos', () => {
  const g = gruposDeOpcionales(unidadDlv(['Chocolate', 'Dulce de leche'], 'Chocolate blanco').selectedOptionals, CATALOGO);
  assert.deepStrictEqual(g.map((x) => x.nombreGrupo), ['SABORES', 'SALSAS']);
  assert.deepStrictEqual(g[0].opciones.map((o) => o.nombre), ['Chocolate', 'Dulce de leche']);
  assert.deepStrictEqual(g[1].opciones.map((o) => o.nombre), ['Chocolate blanco']);
});
check('un grupo que REALMENTE se llama OPCIONALES conserva su nombre', () => {
  const catalogo = [{ id: '9G', nombre: 'OPCIONALES' }];
  const sel = { '9G': [op('Cucurucho', { grupoNombre: 'OPCIONALES' })] };
  const g = gruposDeOpcionales(sel, catalogo);
  assert.strictEqual(g[0].nombreGrupo, 'OPCIONALES');
  assert.strictEqual(g[0].origenTitulo, 'catalogo');
});
check('sin catálogo, manda el título que trae el pedido', () => {
  const g = gruposDeOpcionales(unidadDlv(['Chocolate']).selectedOptionals, []);
  assert.strictEqual(g[0].nombreGrupo, 'SABORES');
  assert.strictEqual(g[0].origenTitulo, 'snapshot');
});
check('sin catálogo y sin grupoNombre, se usa tipoGrupo/departamento', () => {
  const sel = { gX: [op('Nuez', { tipoGrupo: 'TOPPINGS' })] };
  assert.strictEqual(gruposDeOpcionales(sel, [])[0].nombreGrupo, 'TOPPINGS');
  const sel2 = { gY: [op('Nuez', { departamento: 'GUARNICIONES' })] };
  assert.strictEqual(gruposDeOpcionales(sel2, [])[0].nombreGrupo, 'GUARNICIONES');
});
check('histórico sin NADA recuperable: recién ahí OPCIONALES', () => {
  const g = gruposDeOpcionales({ 'g-desconocido': [op('Algo')] }, []);
  assert.strictEqual(g[0].nombreGrupo, TITULO_GRUPO_POR_DEFECTO);
  assert.strictEqual(g[0].origenTitulo, 'fallback');
});
check('el título NUNCA se infiere por el contenido', () => {
  // Una opción llamada "Chocolate" en un grupo sin datos NO se convierte en SABORES.
  assert.strictEqual(gruposDeOpcionales({ zz: [op('Chocolate')] }, [])[0].nombreGrupo, TITULO_GRUPO_POR_DEFECTO);
});
check('el catálogo tiene prioridad sobre el título del pedido', () => {
  // Si el local renombró el grupo, la comanda muestra el nombre configurado hoy.
  const catalogo = [{ id: '1G', nombre: 'GUSTOS' }];
  const g = gruposDeOpcionales(unidadDlv(['Chocolate']).selectedOptionals, catalogo);
  assert.strictEqual(g[0].nombreGrupo, 'GUSTOS');
});
check('la normalización de id no inventa: sólo acepta ids que existen', () => {
  assert.deepStrictEqual(idsCandidatos('group-81A-1G'), ['group-81A-1G', '1G', '81A-1G']);
  // "7G" no está en el catálogo → no se resuelve por catálogo, cae al snapshot.
  const r = resolverTituloGrupo('group-99Z-7G', [op('X', { grupoNombre: 'BEBIDAS' })], CATALOGO);
  assert.strictEqual(r.titulo, 'BEBIDAS');
  assert.strictEqual(r.origen, 'snapshot');
});
check('los títulos posibles no están hardcodeados', () => {
  for (const nombre of ['TOPPINGS', 'ADICIONALES', 'GUARNICIONES', 'BEBIDAS', 'CAFETERIA']) {
    const g = gruposDeOpcionales({ gg: [op('X', { grupoNombre: nombre })] }, []);
    assert.strictEqual(g[0].nombreGrupo, nombre);
  }
});
check('se respeta el orden configurado del catálogo', () => {
  const sel = {
    'group-81A-2G': [op('Frutilla', { grupoNombre: 'SALSAS' })],
    'group-81A-1G': [op('Chocolate', { grupoNombre: 'SABORES' })],
  };
  assert.deepStrictEqual(gruposDeOpcionales(sel, CATALOGO).map((g) => g.nombreGrupo), ['SABORES', 'SALSAS']);
});
check('se respeta numeroOrden dentro del grupo', () => {
  const sel = { '1G': [op('B', { numeroOrden: 2 }), op('A', { numeroOrden: 1 })] };
  assert.deepStrictEqual(gruposDeOpcionales(sel, CATALOGO)[0].opciones.map((o) => o.nombre), ['A', 'B']);
});

console.log('\nHTML de la comanda:');

check('el HTML imprime SABORES y SALSAS, no OPCIONALES', () => {
  const html = generateOptionalsHtml(unidadDlv(['Pistacho', 'Mantecol'], 'Frutilla').selectedOptionals, CATALOGO);
  assert.ok(html.includes('>SABORES<'), html);
  assert.ok(html.includes('>SALSAS<'), html);
  assert.ok(!html.includes('Opcionales'), 'no puede quedar el fallback');
  assert.ok(html.includes('Pistacho') && html.includes('Mantecol') && html.includes('Frutilla'));
});
check('manual y DLV producen el MISMO HTML', () => {
  const m = generateOptionalsHtml(unidadManual(['Pistacho'], 'Frutilla').selectedOptionals, CATALOGO);
  const d = generateOptionalsHtml(unidadDlv(['Pistacho'], 'Frutilla').selectedOptionals, CATALOGO);
  assert.strictEqual(m, d);
});
check('la cantidad del opcional se sigue mostrando', () => {
  const sel = { '1G': [op('Dulce Oreo', { cantidad: 2, quantity: 2 })] };
  assert.ok(generateOptionalsHtml(sel, CATALOGO).includes('Dulce Oreo (x2)'));
});
check('sin opcionales devuelve vacío', () => {
  assert.strictEqual(generateOptionalsHtml(null, CATALOGO), '');
  assert.strictEqual(generateOptionalsHtml({}, CATALOGO), '');
  assert.strictEqual(generateOptionalsHtml({ '1G': [] }, CATALOGO), '');
});
check('los nombres se escapan (no se inyecta HTML)', () => {
  const sel = { '1G': [op('<b>x</b>')] };
  const html = generateOptionalsHtml(sel, CATALOGO);
  assert.ok(html.includes('&lt;b&gt;'), html);
});

console.log('\nUn bloque por unidad, sin numeración:');

check('dos unidades con SABORES distintos: dos bloques', () => {
  const items = [
    unidadDlv(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadDlv(['Pistacho'], 'Frutilla', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  const b = bloquesDeComanda(items);
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(b.map((x) => x.cantidad), [1, 1]);
  assert.ok(b.every((x) => x.esUnidad));
});
check('dos unidades con SALSAS distintas: dos bloques', () => {
  const items = [
    unidadDlv(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadDlv(['Chocolate'], 'Dulce de leche', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(bloquesDeComanda(items).length, 2);
});
check('dos unidades IDÉNTICAS configuradas por separado: TAMBIÉN dos bloques', () => {
  const items = [
    unidadDlv(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadDlv(['Chocolate'], 'Frutilla', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  const b = bloquesDeComanda(items);
  assert.strictEqual(b.length, 2, 'no se colapsan aunque sean iguales');
  assert.deepStrictEqual(b.map((x) => x.cantidad), [1, 1], 'nunca "2x"');
});
check('tres unidades configuradas: tres bloques', () => {
  const items = [
    unidadDlv(['Chocolate'], null, { unidadIndice: 1, unidadTotal: 3 }),
    unidadDlv(['Chocolate'], null, { unidadIndice: 2, unidadTotal: 3 }),
    unidadDlv(['Pistacho'], null, { unidadIndice: 3, unidadTotal: 3 }),
  ];
  const b = bloquesDeComanda(items);
  assert.strictEqual(b.length, 3);
  assert.deepStrictEqual(b.map((x) => x.cantidad), [1, 1, 1]);
});
check('la MISMA regla vale para un pedido manual', () => {
  const iguales = [
    unidadManual(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadManual(['Chocolate'], 'Frutilla', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(bloquesDeComanda(iguales).length, 2);
  const distintas = [
    unidadManual(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadManual(['Pistacho'], 'Frutilla', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(bloquesDeComanda(distintas).length, 2);
});
check('SOLO una cantidad simple conserva "N x ARTÍCULO"', () => {
  const items = [{ id: '99Z', nombre: 'GASEOSA', quantity: 3, valor: 1000 }];
  const b = bloquesDeComanda(items);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].cantidad, 3);
  assert.strictEqual(b[0].esUnidad, false);
});
check('esUnidadConfigurada distingue unidad de cantidad simple', () => {
  assert.strictEqual(esUnidadConfigurada(unidadDlv(['Chocolate'])), true);
  assert.strictEqual(esUnidadConfigurada({ id: 'X', nombre: 'GASEOSA', quantity: 3 }), false);
  assert.strictEqual(esUnidadConfigurada({ id: 'X', nombre: 'X', selectedOptionals: {} }), false);
  assert.strictEqual(esUnidadConfigurada({ id: 'X', nombre: 'X', selectedOptionals: { g: [] } }), false);
  assert.strictEqual(esUnidadConfigurada({ id: 'P', nombre: 'PROMO', promoItems: [{ nombre: 'H1' }] }), true);
});
check('una promo con hijos es su propio bloque', () => {
  const a = { id: 'P', nombre: 'PROMO', quantity: 1, promoItems: [{ nombre: 'H1', selectedOptionals: { g: [op('Choco')] } }] };
  const b = { id: 'P', nombre: 'PROMO', quantity: 1, promoItems: [{ nombre: 'H1', selectedOptionals: { g: [op('Choco')] } }] };
  const bl = bloquesDeComanda([a, b]);
  assert.strictEqual(bl.length, 2);
  assert.deepStrictEqual(bl.map((x) => x.cantidad), [1, 1]);
});
check('NINGUNA selección se pierde ni cambia de unidad', () => {
  const items = [
    unidadDlv(['Chocolate'], 'Frutilla', { unidadIndice: 1, unidadTotal: 2 }),
    unidadDlv(['Pistacho'], 'Dulce de leche', { unidadIndice: 2, unidadTotal: 2 }),
  ];
  const b = bloquesDeComanda(items);
  const html0 = generateOptionalsHtml(b[0].item.selectedOptionals, CATALOGO);
  const html1 = generateOptionalsHtml(b[1].item.selectedOptionals, CATALOGO);
  assert.ok(html0.includes('Chocolate') && html0.includes('Frutilla'));
  assert.ok(html1.includes('Pistacho') && html1.includes('Dulce de leche'));
  assert.ok(!html0.includes('Pistacho'), 'no se mezclan selecciones');
  assert.ok(!html1.includes('Chocolate'), 'no se mezclan selecciones');
});
check('el orden de los bloques es el del pedido', () => {
  const items = [
    unidadDlv(['Chocolate'], null),
    { id: '99Z', nombre: 'GASEOSA', quantity: 2 },
    unidadDlv(['Pistacho'], null),
  ];
  assert.deepStrictEqual(bloquesDeComanda(items).map((x) => x.item.nombre), ['1/4 KILO DE HELADO', 'GASEOSA', '1/4 KILO DE HELADO']);
});

console.log('\nEl pedido 4021 (estructura real, nombres cambiados):');

// Estructura EXACTA del pedido 4021 de Achaval leído de Firebase: ids de grupo
// compuestos, `grupoNombre` presente, dos unidades con selecciones distintas.
const PEDIDO_4021 = {
  id: '4021',
  items: [
    {
      id: '81A', nombre: '1/4 KILO DE HELADO', quantity: 1, valor: 5500,
      precioBaseUnitario: 5500, subtotalLinea: 5500, totalOpcionales: 0,
      unidadIndice: 1, unidadTotal: 2, uniqueId: 'art-81A-...-0',
      selectedOptionals: {
        'group-81A-1G': [
          op('Sabor A', { codigo: '51O', grupoId: 'group-81A-1G', grupoNombre: 'SABORES', id: 'opt-1G-51O' }),
          op('Sabor B', { codigo: '43O', grupoId: 'group-81A-1G', grupoNombre: 'SABORES', id: 'opt-1G-43O' }),
          op('Sabor C', { codigo: '47O', grupoId: 'group-81A-1G', grupoNombre: 'SABORES', id: 'opt-1G-47O' }),
        ],
        'group-81A-2G': [
          op('Salsa A', { codigo: '65O', grupoId: 'group-81A-2G', grupoNombre: 'SALSAS', id: 'opt-2G-65O' }),
        ],
      },
    },
    {
      id: '81A', nombre: '1/4 KILO DE HELADO', quantity: 1, valor: 5500,
      precioBaseUnitario: 5500, subtotalLinea: 5500, totalOpcionales: 0,
      unidadIndice: 2, unidadTotal: 2, uniqueId: 'art-81A-...-1',
      selectedOptionals: {
        'group-81A-1G': [
          op('Sabor D', { codigo: '29O', cantidad: 2, quantity: 2, grupoId: 'group-81A-1G', grupoNombre: 'SABORES', id: 'opt-1G-29O' }),
          op('Sabor E', { codigo: '33O', grupoId: 'group-81A-1G', grupoNombre: 'SABORES', id: 'opt-1G-33O' }),
        ],
        'group-81A-2G': [
          op('Salsa B', { codigo: '62O', grupoId: 'group-81A-2G', grupoNombre: 'SALSAS', id: 'opt-2G-62O' }),
        ],
      },
    },
  ],
};

check('4021: los cuatro grupos salen con su título real', () => {
  const titulos = PEDIDO_4021.items.flatMap((it) => gruposDeOpcionales(it.selectedOptionals, CATALOGO).map((g) => g.nombreGrupo));
  assert.deepStrictEqual(titulos, ['SABORES', 'SALSAS', 'SABORES', 'SALSAS']);
  assert.ok(!titulos.includes('OPCIONALES'));
});
check('4021: se imprime en DOS bloques, sin numeración', () => {
  const b = bloquesDeComanda(PEDIDO_4021.items);
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(b.map((x) => x.cantidad), [1, 1], 'cada bloque vale 1, nunca "2x"');
  assert.deepStrictEqual(b.map((x) => x.item.nombre), ['1/4 KILO DE HELADO', '1/4 KILO DE HELADO'],
    'el nombre del artículo se repite en cada bloque');
  // El modelo no expone NINGÚN campo de numeración de unidad.
  for (const bloque of b) {
    assert.ok(!('unidadIndice' in bloque) && !('unidadTotal' in bloque),
      'el bloque no puede llevar numeración de unidad');
  }
});
check('4021: ninguna selección se pierde y la cantidad x2 se conserva', () => {
  const h = PEDIDO_4021.items.map((it) => generateOptionalsHtml(it.selectedOptionals, CATALOGO));
  assert.ok(h[0].includes('Sabor A') && h[0].includes('Sabor B') && h[0].includes('Sabor C') && h[0].includes('Salsa A'));
  assert.ok(h[1].includes('Sabor D (x2)') && h[1].includes('Sabor E') && h[1].includes('Salsa B'));
  assert.ok(!h.join('').includes('Opcionales'));
});
check('4021: no cambia ningún importe ni ninguna cantidad', () => {
  const b = bloquesDeComanda(PEDIDO_4021.items);
  const total = b.reduce((s, x) => s + x.cantidad * Number(x.item.precioBaseUnitario), 0);
  assert.strictEqual(total, 11000, 'el total del pedido 4021 no puede moverse');
  const items = b.reduce((s, x) => s + x.cantidad, 0);
  assert.strictEqual(items, 2, 'siguen siendo 2 items');
});

console.log('\nLa comanda NO puede numerar unidades:');

// `command.js` arma HTML y depende de Electron/React, así que no se puede
// ejecutar acá. Se verifica sobre su CÓDIGO que no exista ninguna forma de
// imprimir la numeración: es la garantía de que no vuelve por descuido.
const fuenteComanda = readFileSync(new URL('../command.js', import.meta.url), 'utf8');

/** Código sin comentarios: los comentarios SÍ pueden nombrar la regla vieja. */
const soloCodigo = (src) => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

check('command.js no puede imprimir "UNIDAD X DE Y"', () => {
  const codigo = soloCodigo(fuenteComanda);
  assert.ok(!/UNIDAD/i.test(codigo), 'quedó un "UNIDAD" imprimible en la comanda');
  assert.ok(!/DE \$\{/.test(codigo), 'quedó una plantilla "N DE M"');
  assert.ok(!/unidadIndice|unidadTotal/.test(codigo), 'la comanda no debe leer la numeración de unidad');
});
check('command.js separa los bloques visualmente', () => {
  assert.ok(fuenteComanda.includes('item-separator'), 'falta el separador entre bloques');
  assert.ok(/\.item-separator\s*\{[^}]*height/.test(fuenteComanda), 'el separador debe ocupar espacio real');
  assert.ok(fuenteComanda.includes('bloquesDeComanda'), 'la comanda debe usar el modelo de bloques');
});
check('el modelo tampoco expone numeración de unidad', () => {
  const fuenteModelo = readFileSync(new URL('../comandaModelo.js', import.meta.url), 'utf8');
  assert.ok(!/unidadIndice|unidadTotal/.test(soloCodigo(fuenteModelo)), 'el modelo no debe leer la numeración');
});

// ---------------------------------------------------------------------------
// UNA LÍNEA CONFIGURADA CON quantity > 1
//
// DLV Pedidos Web manda UNA sola línea con quantity: 2 cuando las dos unidades
// llevan la misma selección. Antes la comanda forzaba esas líneas a 1 y salía
// "1x" mientras el total cobraba dos. La cantidad tiene que salir del `quantity`
// de la línea, siempre.
// ---------------------------------------------------------------------------
console.log('\nCantidad de una línea configurada:');

for (const q of [1, 2, 5]) {
  check(`configurado + quantity ${q} → ${q}x, en UN solo bloque`, () => {
    const b = bloquesDeComanda([unidadDlv(['Dulce Granizado'], 'Frutilla', { quantity: q })]);
    assert.strictEqual(b.length, 1, 'una línea es un bloque: la selección se imprime una sola vez');
    assert.strictEqual(b[0].cantidad, q);
    assert.strictEqual(b[0].esUnidad, true, 'sigue siendo una unidad configurada');
  });
}

check('sin quantity válido, cae a 1', () => {
  for (const q of [undefined, null, 0, -3, 'dos', NaN]) {
    const b = bloquesDeComanda([unidadDlv(['Chocolate'], null, { quantity: q })]);
    assert.strictEqual(b[0].cantidad, 1, `quantity=${JSON.stringify(q)} debería caer a 1`);
  }
});

check('una línea SIN configuración sigue respetando su quantity', () => {
  const b = bloquesDeComanda([{ id: '9', nombre: 'GASEOSA', quantity: 3 }]);
  assert.strictEqual(b[0].cantidad, 3);
  assert.strictEqual(b[0].esUnidad, false);
});

check('respetar quantity NO agrupa líneas distintas', () => {
  // Dos líneas configuradas de a 1 siguen siendo dos bloques: pueden tener
  // selecciones distintas y se preparan por separado.
  const b = bloquesDeComanda([
    unidadDlv(['Chocolate'], 'Frutilla', { quantity: 1 }),
    unidadDlv(['Pistacho'], 'Dulce de leche', { quantity: 1 }),
  ]);
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(b.map((x) => x.cantidad), [1, 1]);
});

check('líneas con configuraciones distintas nunca se juntan, ni con quantity > 1', () => {
  const b = bloquesDeComanda([
    unidadDlv(['Chocolate'], 'Frutilla', { quantity: 2 }),
    unidadDlv(['Pistacho'], 'Frutilla', { quantity: 3 }),
  ]);
  assert.strictEqual(b.length, 2, 'cada línea conserva su bloque');
  assert.deepStrictEqual(b.map((x) => x.cantidad), [2, 3], 'cada una con SU cantidad');
});

// ---------------------------------------------------------------------------
console.log('\nPedido REAL 7785 (Centenario, 09/08/2026):');

// Payload tal cual quedó en /51501748/PEDIDOS/7785. Total $11.000 = 5500 × 2.
const PEDIDO_7785 = [{
  id: '85',
  nombre: '1/4 KILO DE HELADO',
  quantity: 2,
  valor: 5500,
  selectedOptionals: {
    '1G': [
      { nombre: 'Dulce Granizado', quantity: 1 },
      { nombre: 'Mantecol', quantity: 1 },
      { nombre: 'Bananita Dolca', quantity: 1 },
    ],
    '2G': [{ nombre: 'Frutilla', quantity: 1 }],
  },
}];

check('sale 2x 1/4 KILO DE HELADO, no 1x', () => {
  const b = bloquesDeComanda(PEDIDO_7785);
  assert.strictEqual(b.length, 1, 'un solo bloque');
  assert.strictEqual(b[0].cantidad, 2, 'era el bug: salía 1x mientras se cobraban 2');
  assert.strictEqual(b[0].item.nombre, '1/4 KILO DE HELADO');
});

check('la cantidad coincide con lo que se cobró', () => {
  const it = PEDIDO_7785[0];
  const b = bloquesDeComanda(PEDIDO_7785);
  assert.strictEqual(it.valor * b[0].cantidad, 11000, 'la comanda tiene que cuadrar con el total del pedido');
});

check('los sabores y la salsa se imprimen UNA sola vez', () => {
  const b = bloquesDeComanda(PEDIDO_7785);
  const grupos = gruposDeOpcionales(b[0].item.selectedOptionals, CATALOGO);
  const nombres = grupos.flatMap((g) => g.opciones.map((o) => o.nombre));
  assert.deepStrictEqual(nombres, ['Dulce Granizado', 'Mantecol', 'Bananita Dolca', 'Frutilla']);
  assert.strictEqual(nombres.length, new Set(nombres).size, 'no se duplica ningún opcional por la cantidad');
});

console.log(`\n${passed} verificaciones OK`);
