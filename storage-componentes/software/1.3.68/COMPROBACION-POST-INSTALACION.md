# Comprobación después de instalar 1.3.68 en Centenario y en Il Capo

Ejecutar **en la PC del local**, después de instalar. No requiere emitir ninguna
factura: la venta de prueba es una venta normal cobrada con `Transferencia 2`,
que con el interruptor apagado **no genera ningún comprobante fiscal**.

Locales a verificar: **51501748 (Centenario)** y **31915636 (Il Capo)**.

---

## 1. Confirmar la versión instalada

En la app: menú de configuración → información de la aplicación.
Debe decir **1.3.68**.

Si sigue diciendo 1.3.67, la actualización no se aplicó: cerrar la app por
completo (incluido el ícono de la bandeja) y volver a abrirla.

---

## 2. Confirmar que la cuenta sigue como estaba

En Gestión de Cuentas, la cuenta **Transferencia 2** debe tener:

- `Imprime Factura`: **apagado**
- favorita: **sí** (no cambiar)

En Configuración → Facturación, el panel *Cuentas fiscales por cola* debe mostrar:

- `FACTURACION_1` → **Facturación lista**, con el CUIT y el punto de venta del local.
- `FACTURACION_2` → **No factura — genera remito**, en gris, sin pedir ningún dato.

`FACTURACION_2` **no** debe aparecer en rojo ni reclamar CUIT, certificado,
punto de venta ni motor de facturación.

---

## 3. Venta de prueba con Transferencia 2

Hacer **una** venta de mostrador normal, cobrada íntegramente con `Transferencia 2`.
Anotar el importe y la hora.

### 3.1 Debe aparecer un FCX nuevo

Ruta: `/{localId}/Remitos`

- Aparece una clave nueva `FCX{ptoVta}-{8 dígitos}`.
- Su `total` es el **total completo** de la venta.
- `facturado` es `false`.
- `productos` trae los renglones con `cantidad`, `precioUnitario` y `precioTotal`.

### 3.2 NO debe aparecer nada nuevo en la cola

Ruta: `/{localId}/FACTURACION_2`

Anotar la cantidad de claves **antes** de la venta y volver a contarlas después.
**Tiene que ser el mismo número.**

Referencia al 27-07-2026, antes de actualizar:

| Local | `/FACTURACION_2` | `/Remitos` |
|---|---|---|
| 51501748 Centenario | **587** | 0 |
| 31915636 Il Capo | **242** | 57 |

Los pendientes históricos **no se tocan**: no se emiten, no se borran, no se
convierten. Sólo tiene que dejar de crecer el número.

---

## 4. Pestaña Ventas → Remitos

- El remito recién emitido aparece en la lista con el filtro **Hoy**.
- El contador de la solapa coincide con la cantidad de filas.
- El importe de la fila es el total de la venta.

---

## 5. Reimpresión

Imprimir el remito desde la pestaña Remitos:

- Encabezado **Remito**, con la leyenda *Documento no válido como factura*.
- Detalle con descripción, cantidad, precio unitario y subtotal.
- **TOTAL** igual al de la venta.
- **Sin CAE, sin QR de ARCA y sin letra fiscal** — es un remito, no una factura.

---

## 6. Stock, caja y comisiones: una sola vez

- El stock de los artículos vendidos bajó **una** vez.
- La caja del turno registra la venta **una** vez, por el total.
- La comisión del vendedor, si corresponde, figura **una** vez.
- En `/{localId}/MOSTRADOR/{id}` la venta tiene la clave `remito` con el número
  del FCX emitido. Volver a guardarla no genera un segundo remito.

---

## 7. Prueba del tilde manual (opcional, sólo si se necesita facturar)

Con el tilde **Emite Factura** activado y cobrando con `Transferencia 2`, la
venta **no** debe ir a `FACTURACION_2`: debe facturarse con la cuenta fiscal
habilitada del local (`Transferencia` → `FACTURACION_1`).

Si el local no tuviera ninguna cuenta con *Imprime Factura* encendido, la
operación se detiene con el aviso *"No hay una cuenta fiscal habilitada para
emitir esta factura"*. Eso es correcto: no debe salir un remito cuando el
usuario pidió una factura.

---

## Si algo no coincide

No corregir a mano en Firebase. Anotar:

- versión instalada,
- local,
- número de FCX (o su ausencia),
- cantidad de claves en `/FACTURACION_2` antes y después,
- captura del panel *Cuentas fiscales por cola*.
