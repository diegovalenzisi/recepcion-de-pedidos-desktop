import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getBusinessName } from '@/lib/businessNameUtils';
import { lineasDeItem } from '@/lib/print/orderPrintDetail';

// COMPROBANTE FISCAL (reimpresión de la factura AFIP). Sus renglones e importes
// salen del registro fiscal guardado (FACTURAS/…/ARTICULOS), NUNCA del catálogo
// actual ni de un recálculo local: reimprimir no puede cambiar lo facturado.
// El desglose de opcionales sólo se muestra si el propio registro lo trae; si no
// lo trae (comprobantes históricos), el renglón se imprime como siempre.
//
// También reimprime REMITOS (FCX): mismos renglones, pero salen del registro
// guardado en /{localId}/Remitos y el encabezado aclara que NO es una factura.
// Igual que con la factura, reimprimir es sólo lectura: no crea una venta nueva,
// no toca stock ni caja.
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
  
  // Get location-specific business name
  const businessName = getBusinessName();

  return (
    <div className="receipt">
      <div className="header">
        <h1>{businessName}</h1>
        <h2>{sale.esRemito ? 'Remito' : 'Comprobante de Venta'}</h2>
        {sale.esRemito && (
          <p style={{ fontSize: '0.85em' }}>Documento no válido como factura</p>
        )}
        <p>#{sale.numeroFactura || sale.id}</p>
      </div>
      <hr />
      <table className="details">
        <tbody>
          <tr>
            <td>Fecha:</td>
            <td style={{ textAlign: 'right' }}>{sale.fecha}</td>
          </tr>
          <tr>
            <td>Hora:</td>
            <td style={{ textAlign: 'right' }}>{sale.hora}</td>
          </tr>
          <tr>
            <td>Modo:</td>
            <td style={{ textAlign: 'right' }}>{sale.modo}</td>
          </tr>
          {sale.cliente && sale.cliente.nombre && (
            <tr>
              <td>Cliente:</td>
              <td style={{ textAlign: 'right' }}>{sale.cliente.nombre}</td>
            </tr>
          )}
        </tbody>
      </table>
      <hr />
      <table className="items">
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="qty">Cant.</th>
            <th className="price">Precio</th>
          </tr>
        </thead>
        <tbody>
          {articulos.map((item, index) => (
            <tr key={index} className="item-row">
              <td>
                {item.nombre}
                {Number(item.unidadTotal) > 1 && Number.isFinite(Number(item.unidadIndice))
                  ? ` — Unidad ${item.unidadIndice} de ${item.unidadTotal}`
                  : ''}
                {detalleOpcionales(item)}
              </td>
              <td className="qty">{item.cantidad}</td>
              <td className="price">{formatCurrency(item.precioTotal)}</td>
            </tr>
          ))}
        </tbody>
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
        <p>¡Gracias por su compra!</p>
        <p style={{ fontSize: '12px', marginTop: '5px' }}>{businessName}</p>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '20px' }}>
          <QRCodeSVG value={String(sale.numeroFactura || sale.id || '0000')} size={150} />
          <p style={{ marginTop: '8px', fontSize: '14px', fontWeight: 'bold' }}>
            Orden: #{sale.numeroFactura || sale.id}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ReceiptDocument;