import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getBusinessName } from '@/lib/businessNameUtils';

const ReceiptDocument = ({ sale }) => {
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(value || 0);
  };
  
  const articulos = Array.isArray(sale.articulos) ? sale.articulos : [];
  
  // Get location-specific business name
  const businessName = getBusinessName();

  return (
    <div className="receipt">
      <div className="header">
        <h1>{businessName}</h1>
        <h2>Comprobante de Venta</h2>
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
              <td>{item.nombre}</td>
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