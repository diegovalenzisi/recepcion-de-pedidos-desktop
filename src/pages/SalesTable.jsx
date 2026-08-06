import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Printer, FileText, Loader2, AlertCircle, CheckCircle2, Receipt } from 'lucide-react';
import {
  ESTADO_ERROR,
  ESTADO_FACTURADO,
  ESTADO_PENDIENTE,
  describirEstadoFacturacion,
  estadoFacturacion,
  puedeFacturarse,
} from '@/lib/api/facturacionDeRemito';
import { totalNoFacturado } from '@/lib/api/remitos';

/** Cómo se ve el estado de facturación de un remito en el listado. */
const EstadoRemito = ({ fila }) => {
  const estado = estadoFacturacion(fila);
  const texto = describirEstadoFacturacion(fila);

  if (estado === ESTADO_FACTURADO) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {texto}
      </span>
    );
  }
  if (estado === ESTADO_PENDIENTE) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {texto}
      </span>
    );
  }
  if (estado === ESTADO_ERROR) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5"
        title={fila.errorFacturacion || ''}
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {texto}
      </span>
    );
  }
  return <span className="text-xs text-slate-400">{texto}</span>;
};

const SalesTable = ({ data, onPrint, tableType, onFacturarRemito = null, facturando = null, onVerFactura = null, imprimiendo = null }) => {
  const formatCurrency = (value) => {
    const numberValue = Number(value);
    if (isNaN(numberValue)) {
        return '$ 0,00';
    }
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(numberValue);
  };

  const showModoColumn = tableType !== 'invoices';
  const esRemitos = tableType === 'delivery_notes';

  // En Remitos los facturados siguen listados, pero su importe ya está contado
  // en Facturación: no se suma dos veces.
  const totalAmount = esRemitos
    ? totalNoFacturado(data)
    : data.reduce((sum, item) => sum + (Number(item.importe) || 0), 0);

  // Fecha, Hora, N°, Importe, Acciones (5 fijas), más Modo cuando corresponde y
  // una columna extra que es Tipo en facturas y Estado en remitos.
  const columnas = 5 + (showModoColumn ? 1 : 0) + 1;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex flex-col h-full space-y-4">
      <ScrollArea className="flex-1 rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-gray-50 z-10">
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead>N° Comprobante</TableHead>
              {!esRemitos && <TableHead>Tipo</TableHead>}
              {showModoColumn && <TableHead>Modo</TableHead>}
              {esRemitos && <TableHead>Estado</TableHead>}
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-center">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length > 0 ? (
              data.map((item) => {
                const enCurso = facturando === item.numeroFactura;
                // Impresión directa en curso para ESTA factura: bloquea su botón.
                const enImpresion = !!imprimiendo && imprimiendo === (item.id || item.numeroCompleto || item.numeroFactura);
                const habilitado = esRemitos && !!onFacturarRemito && puedeFacturarse(item) && !enCurso;
                return (
                <TableRow key={item.id}>
                  <TableCell>{item.fecha}</TableCell>
                  <TableCell>{item.hora}</TableCell>
                  <TableCell className="font-medium">{item.numeroFactura}</TableCell>
                  {/* La letra sale del CbteTipo de ARCA o de la cuenta emisora,
                      NUNCA del prefijo de la clave: hay comprobantes guardados
                      como FCB… que son Facturas C. */}
                  {!esRemitos && (
                    <TableCell>
                      {item.tipoNombre || '—'}
                      {item.tipoInferido && (
                        <span className="ml-1 text-xs text-amber-600" title="Tipo inferido de la condición fiscal actual del local: el comprobante no guarda su tipo y no se pudo identificar la cuenta emisora.">
                          (inferido)
                        </span>
                      )}
                    </TableCell>
                  )}
                  {showModoColumn && <TableCell>{item.modo}</TableCell>}
                  {esRemitos && <TableCell><EstadoRemito fila={item} /></TableCell>}
                  <TableCell className={`text-right font-semibold ${esRemitos && item.facturado ? 'text-slate-400' : ''}`}>
                    {formatCurrency(item.importe)}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center">
                      {/* IMPRESORA — SÓLO en Facturación, y directo por la
                          impresora predeterminada (sin visor ni diálogo).
                          En "Facturación 2" NO hay impresión: esos comprobantes
                          se imprimen recién cuando pasan a Facturación. */}
                      {!esRemitos && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={enImpresion}
                                onClick={() => onPrint(item)}
                              >
                                {enImpresion
                                  ? <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
                                  : <Printer className="h-4 w-4 text-slate-600" />}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {enImpresion ? 'Imprimiendo…' : 'Imprimir factura (directo, sin vista previa)'}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* VER FACTURA. Éste —y sólo éste— abre el PDF. */}
                      {!esRemitos && onVerFactura && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => onVerFactura(item)}>
                              <FileText className="h-4 w-4 text-slate-600" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Ver factura</TooltipContent>
                        </Tooltip>
                      )}

                      {esRemitos && !item.facturado && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* span: un botón deshabilitado no dispara el tooltip */}
                            <span>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={!habilitado}
                                onClick={() => onFacturarRemito(item)}
                              >
                                {/* Recibo con signo $: distingue "convertir en
                                    factura" del ícono de documento simple. */}
                                {enCurso
                                  ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                  : <Receipt className={`h-4 w-4 ${habilitado ? 'text-blue-600' : 'text-slate-300'}`} />}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {estadoFacturacion(item) === ESTADO_PENDIENTE
                              ? 'Procesando factura: ya hay una solicitud en curso'
                              : estadoFacturacion(item) === ESTADO_ERROR
                                ? 'Reintentar el envío a facturación'
                                : 'Enviar a facturación'}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Ya facturado: NINGUNA acción en esta pestaña. La
                          factura se ve y se imprime desde Facturación. */}
                      {esRemitos && item.facturado && (
                        <span className="text-xs text-slate-400 px-2">—</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );})
            ) : (
              <TableRow>
                <TableCell colSpan={columnas} className="text-center h-24 text-slate-500">
                  No se encontraron registros para este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
      <div className="bg-slate-50 p-4 rounded-lg border flex justify-between items-center shadow-sm">
        <span className="font-semibold text-slate-700">Total de Registros: {data.length}</span>
        <div className="text-right">
          <span className="text-sm text-slate-500 mr-2">
            {esRemitos ? 'Importe Total (sin facturar):' : 'Importe Total:'}
          </span>
          <span className="text-xl font-bold text-slate-800">{formatCurrency(totalAmount)}</span>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
};

export default SalesTable;
