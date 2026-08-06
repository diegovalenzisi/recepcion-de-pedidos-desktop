import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getBusinessName } from '@/lib/businessNameUtils';
import { lineasDeItem } from '@/lib/print/orderPrintDetail';
import { totalesImpositivos, validarComprobanteFiscal } from '@/lib/api/comprobanteFiscal';

// REIMPRESIÓN DE COMPROBANTES
//
// Dos documentos distintos, nunca mezclados:
//
//   FACTURA (FCB/FCC) → reimpresión del comprobante FISCAL. Encabezado del
//        emisor, letra real del comprobante, detalle, CAE, vencimiento y QR
//        OFICIAL de ARCA. Todo sale del registro fiscal guardado: reimprimir no
//        puede cambiar lo facturado ni recalcular nada.
//
//   REMITO (FCX)     → comprobante NO fiscal, sin CAE y sin QR de ARCA, con la
//        leyenda de que no es válido como factura.
//
// LO QUE ESTE COMPONENTE NO HACE:
//   - no inventa datos fiscales: si falta el CAE, el detalle o el emisor, NO
//     imprime un documento que parezca una factura; imprime el motivo. Una
//     factura con total pero sin detalle de productos no es una factura;
//   - no genera un QR con el número interno del pedido. El QR es el de ARCA,
//     reconstruido con los datos del propio comprobante, o no hay QR.
//
// El PDF ORIGINAL que devolvió el runtime de AFIP, cuando está guardado, tiene
// prioridad sobre esta reimpresión (ver handlePrint en SalesPage).
const ReceiptDocument = ({ sale }) => {
  const formatCurrency = (value) => {
    const num = Number(value);
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(Number.isFinite(num) ? num : 0);
  };

  // Un único estilo monetario en todo el comprobante: el desglose usa el mismo
  // formateador que el TOTAL (no se mezclan dos formatos en el mismo ticket).
  const detalleOpcionales = (item) => {
    if (!item || !item.selectedOptionals) return null;
    const lineas = lineasDeItem(
      { ...item, valor: undefined, precioBaseUnitario: undefined, subtotalLinea: undefined },
      { formatImporte: formatCurrency }
    ).slice(1);
    if (lineas.length === 0) return null;
    return lineas.map((l, i) => {
      const sep = l.indexOf('|');
      return (
        <div key={i} className="receipt-optional" style={{ fontSize: '0.85em', display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
          <span>{sep === -1 ? l : l.slice(0, sep)}</span>
          {sep !== -1 && <span style={{ whiteSpace: 'nowrap' }}>{l.slice(sep + 1)}</span>}
        </div>
      );
    });
  };

  const articulos = Array.isArray(sale.articulos) ? sale.articulos : [];
  const businessName = getBusinessName();

  const filaDetalle = (item, index) => (
    <tr key={index} className="item-row">
      <td>
        {item.nombre}
        {Number(item.unidadTotal) > 1 && Number.isFinite(Number(item.unidadIndice))
          ? ` — Unidad ${item.unidadIndice} de ${item.unidadTotal}`
          : ''}
        {detalleOpcionales(item)}
      </td>
      <td className="qty">{item.cantidad}</td>
      <td className="price">{formatCurrency(item.precioUnitario)}</td>
      <td className="price">{formatCurrency(item.precioTotal)}</td>
    </tr>
  );

  // -------------------------------------------------------------------------
  // REMITO — comprobante no fiscal
  // -------------------------------------------------------------------------
  if (sale.esRemito) {
    return (
      <div className="receipt">
        <div className="header">
          <h1>{businessName}</h1>
          <h2>Remito</h2>
          <p style={{ fontSize: '0.85em' }}>Documento no válido como factura</p>
          <p>#{sale.numeroFactura || sale.id}</p>
        </div>
        <hr />
        <table className="details">
          <tbody>
            <tr><td>Fecha:</td><td style={{ textAlign: 'right' }}>{sale.fecha}</td></tr>
            <tr><td>Hora:</td><td style={{ textAlign: 'right' }}>{sale.hora}</td></tr>
            {sale.modo && <tr><td>Modo:</td><td style={{ textAlign: 'right' }}>{sale.modo}</td></tr>}
            {sale.formaPago && <tr><td>Forma de pago:</td><td style={{ textAlign: 'right' }}>{sale.formaPago}</td></tr>}
            {sale.cliente?.nombre && (
              <tr><td>Cliente:</td><td style={{ textAlign: 'right' }}>{sale.cliente.nombre}</td></tr>
            )}
          </tbody>
        </table>
        <hr />
        <table className="items">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="qty">Cant.</th>
              <th className="price">P. Unit.</th>
              <th className="price">Subtotal</th>
            </tr>
          </thead>
          <tbody>{articulos.map(filaDetalle)}</tbody>
        </table>
        <hr />
        <table className="totals">
          <tbody>
            <tr>
              <td><strong>TOTAL:</strong></td>
              <td style={{ width: '100px', textAlign: 'right' }}><strong>{formatCurrency(sale.importe)}</strong></td>
            </tr>
          </tbody>
        </table>
        <hr />
        <div className="footer" style={{ textAlign: 'center', marginTop: '10px' }}>
          <p>Documento no válido como factura</p>
          <p style={{ fontSize: '12px', marginTop: '5px' }}>{businessName}</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // FACTURA — comprobante fiscal
  // -------------------------------------------------------------------------
  const { valido, problemas, avisos } = validarComprobanteFiscal(sale);

  // Un comprobante fiscal incompleto NO se imprime como si fuera válido: se
  // informa qué le falta. Es preferible a entregar un papel con el título de una
  // factura, un total y la tabla de productos vacía.
  if (!valido) {
    return (
      <div className="receipt">
        <div className="header">
          <h1>{businessName}</h1>
          <h2>Comprobante incompleto</h2>
          <p>#{sale.numeroFactura || sale.id}</p>
        </div>
        <hr />
        <p style={{ fontWeight: 'bold' }}>No se puede reimprimir este comprobante como factura fiscal.</p>
        <ul style={{ paddingLeft: '18px', margin: '8px 0' }}>
          {problemas.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
        <hr />
        <table className="details">
          <tbody>
            <tr><td>Fecha:</td><td style={{ textAlign: 'right' }}>{sale.fecha || '—'}</td></tr>
            <tr><td>Total registrado:</td><td style={{ textAlign: 'right' }}>{formatCurrency(sale.importe)}</td></tr>
            {sale.cae && <tr><td>CAE:</td><td style={{ textAlign: 'right' }}>{sale.cae}</td></tr>}
          </tbody>
        </table>
        <hr />
        <p style={{ fontSize: '0.8em' }}>
          Este documento NO es una factura y no reemplaza al comprobante fiscal original.
          {sale.pdfArchivo ? ` El PDF original quedó guardado en la PC de facturación como "${sale.pdfArchivo}".` : ''}
        </p>
      </div>
    );
  }

  const imp = totalesImpositivos(sale);
  const emisor = sale.emisor || {};

  return (
    <div className="receipt">
      <div className="header">
        <h1>{emisor.fantasia || businessName}</h1>
        <div className="letra" style={{ fontSize: '2em', fontWeight: 'bold', lineHeight: 1 }}>{sale.letra}</div>
        <h2>{sale.tipoNombre}</h2>
        <p>Nº {sale.numeroCompleto}</p>
      </div>
      <hr />

      {/* Datos del emisor */}
      <table className="details">
        <tbody>
          {emisor.razonSocial && <tr><td>Razón social:</td><td style={{ textAlign: 'right' }}>{emisor.razonSocial}</td></tr>}
          {emisor.fantasia && <tr><td>Nombre de fantasía:</td><td style={{ textAlign: 'right' }}>{emisor.fantasia}</td></tr>}
          {emisor.cuit && <tr><td>CUIT:</td><td style={{ textAlign: 'right' }}>{emisor.cuit}</td></tr>}
          {emisor.domicilio && <tr><td>Domicilio comercial:</td><td style={{ textAlign: 'right' }}>{emisor.domicilio}</td></tr>}
          {emisor.condIVA && <tr><td>Condición frente al IVA:</td><td style={{ textAlign: 'right' }}>{emisor.condIVA}</td></tr>}
          {emisor.iibb && <tr><td>Ingresos Brutos:</td><td style={{ textAlign: 'right' }}>{emisor.iibb}</td></tr>}
          {emisor.inicioActividades && <tr><td>Inicio de actividades:</td><td style={{ textAlign: 'right' }}>{emisor.inicioActividades}</td></tr>}
          <tr><td>Punto de venta:</td><td style={{ textAlign: 'right' }}>{sale.puntoVenta}</td></tr>
        </tbody>
      </table>
      <hr />

      {/* Datos del comprobante y del receptor */}
      <table className="details">
        <tbody>
          <tr><td>Fecha de emisión:</td><td style={{ textAlign: 'right' }}>{sale.fecha}</td></tr>
          {sale.hora && <tr><td>Hora:</td><td style={{ textAlign: 'right' }}>{sale.hora}</td></tr>}
          <tr><td>Cliente:</td><td style={{ textAlign: 'right' }}>{sale.cliente?.nombre}</td></tr>
          {sale.direccion && <tr><td>Domicilio:</td><td style={{ textAlign: 'right' }}>{sale.direccion}</td></tr>}
          <tr>
            <td>Documento receptor:</td>
            <td style={{ textAlign: 'right' }}>
              {Number(sale.docNroReceptor) > 0 ? `${sale.docTipoReceptor} ${sale.docNroReceptor}` : 'No requiere'}
            </td>
          </tr>
          <tr><td>Cond. IVA receptor:</td><td style={{ textAlign: 'right' }}>{sale.condIVAReceptor}</td></tr>
          {sale.formaPago && <tr><td>Forma de pago:</td><td style={{ textAlign: 'right' }}>{sale.formaPago}</td></tr>}
          {sale.modo && <tr><td>Modo:</td><td style={{ textAlign: 'right' }}>{sale.modo}</td></tr>}
        </tbody>
      </table>
      <hr />

      {/* Detalle */}
      <table className="items">
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="qty">Cant.</th>
            <th className="price">P. Unit.</th>
            <th className="price">Subtotal</th>
          </tr>
        </thead>
        <tbody>{articulos.map(filaDetalle)}</tbody>
      </table>
      <hr />

      {/* Totales impositivos */}
      <table className="totals">
        <tbody>
          {imp.discrimina && imp.neto !== null && (
            <>
              <tr>
                <td>Neto gravado:</td>
                <td style={{ width: '110px', textAlign: 'right' }}>{formatCurrency(imp.neto)}</td>
              </tr>
              <tr>
                <td>{`IVA ${imp.alicuota}%:`}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(imp.iva)}</td>
              </tr>
            </>
          )}
          <tr>
            <td><strong>TOTAL:</strong></td>
            <td style={{ width: '110px', textAlign: 'right' }}><strong>{formatCurrency(sale.importe)}</strong></td>
          </tr>
        </tbody>
      </table>
      <hr />

      {/* Datos fiscales finales */}
      <table className="details">
        <tbody>
          <tr><td>CAE:</td><td style={{ textAlign: 'right' }}>{sale.cae}</td></tr>
          {sale.caeVtoLegible && (
            <tr><td>Vencimiento del CAE:</td><td style={{ textAlign: 'right' }}>{sale.caeVtoLegible}</td></tr>
          )}
        </tbody>
      </table>

      <div className="footer" style={{ textAlign: 'center', marginTop: '10px' }}>
        <p style={{ fontSize: '0.8em' }}>Comprobante autorizado por ARCA</p>
        <p style={{ fontSize: '0.8em' }}>
          {imp.discrimina
            ? 'El IVA se encuentra incluido en el precio. No discrimina crédito fiscal al consumidor final.'
            : 'Régimen Simplificado para Pequeños Contribuyentes (Monotributo). El IVA no se discrimina.'}
        </p>

        {sale.qrUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '14px' }}>
            <QRCodeSVG value={sale.qrUrl} size={120} />
            <p style={{ marginTop: '6px', fontSize: '11px' }}>QR oficial ARCA</p>
          </div>
        )}

        {avisos.length > 0 && (
          <div style={{ marginTop: '10px', fontSize: '0.72em', textAlign: 'left' }}>
            {avisos.map((a, i) => <p key={i} style={{ margin: '2px 0' }}>· {a}</p>)}
          </div>
        )}

        <p style={{ fontSize: '11px', marginTop: '8px' }}>Reimpresión — {emisor.fantasia || businessName}</p>
      </div>
    </div>
  );
};

export default ReceiptDocument;
