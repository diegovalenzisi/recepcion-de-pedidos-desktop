import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Inbox, FileText } from 'lucide-react';
import { radiografiaDelLocal } from '@/lib/api/colasFiscalesApi';
import { ESTADO, ETIQUETA_ESTADO } from '@/lib/api/colasFiscales';

// ---------------------------------------------------------------------------
// ESTADO DE LAS NUEVE COLAS FISCALES DEL LOCAL
//
// Cada FACTURACION_N es una CUENTA FISCAL distinta: otro CUIT, otro punto de
// venta, otro certificado. Este panel muestra, cola por cola, si está en
// condiciones de facturar y —cuando no lo está— exactamente qué le falta.
//
// Es la MISMA función que usa la auditoría (radiografiaDeColas), así que la
// pantalla y el informe nunca pueden decir cosas distintas.
//
// Sólo LEE. No emite comprobantes, no procesa pendientes y no toca las colas.
// ---------------------------------------------------------------------------

const ICONO = {
  [ESTADO.LISTA]: { Icon: CheckCircle2, clase: 'text-green-600' },
  // Una cuenta de cobro con "Imprime Factura" apagado es una decisión del dueño,
  // no un error: se muestra en gris, nunca en rojo.
  [ESTADO.NO_FACTURA]: { Icon: FileText, clase: 'text-slate-500' },
  [ESTADO.INCOMPLETA]: { Icon: AlertTriangle, clase: 'text-amber-600' },
  [ESTADO.SIN_RUNTIME]: { Icon: AlertTriangle, clase: 'text-amber-600' },
  [ESTADO.CERTIFICADO_INVALIDO]: { Icon: XCircle, clase: 'text-red-600' },
  [ESTADO.PUNTO_VENTA_FALTANTE]: { Icon: XCircle, clase: 'text-red-600' },
  [ESTADO.HUERFANA]: { Icon: XCircle, clase: 'text-red-600' },
  [ESTADO.NO_CONFIGURADA]: { Icon: Inbox, clase: 'text-gray-400' },
};

function FilaCola({ fila }) {
  const { Icon, clase } = ICONO[fila.estado] || ICONO[ESTADO.NO_CONFIGURADA];
  const etiqueta = ETIQUETA_ESTADO[fila.estado] || 'Sin configurar';
  const c = fila.cuenta;

  // Una cola sin configurar, sin pendientes y sin cuenta de cobro encendida es
  // sólo una cola libre: no es un problema y no se muestra en rojo.
  if (!fila.configurada && fila.pendientes === 0 && fila.imprimeFactura !== true) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
        <Inbox className="h-3 w-3 shrink-0" />
        <span className="font-mono w-32 shrink-0">{fila.cola}</span>
        <span className="truncate">
          {fila.imprimeFactura === false
            ? `no factura — "${fila.cuentaCobro}" genera remito`
            : `libre${fila.cuentaCobro ? ` — se alimenta de "${fila.cuentaCobro}"` : ''}`}
        </span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t first:border-t-0">
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${clase}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs font-semibold">{fila.cola}</span>
            <span className={`text-xs font-medium ${clase}`}>{etiqueta}</span>
            {fila.pendientes > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                fila.huerfana ? 'bg-red-100 text-red-800'
                  : fila.pendientesHistoricos ? 'bg-slate-100 text-slate-700'
                  : 'bg-blue-100 text-blue-800'}`}>
                {fila.pendientes} pendiente{fila.pendientes === 1 ? '' : 's'}
                {fila.pendientesHistoricos ? ' (históricos)' : ''}
              </span>
            )}
          </div>

          {fila.noFactura && (
            <p className="text-xs text-slate-500 mt-0.5">
              La cuenta “{fila.cuentaCobro}” tiene “Imprime Factura” apagado: sus ventas generan remito.
              No necesita CUIT, punto de venta, certificado ni motor de facturación.
            </p>
          )}

          {c && (
            <p className="text-xs text-gray-600 mt-0.5">
              {[c.razonSocial, c.cuitFormat || c.cuit, c.puntoVenta ? `Pto. Vta. ${c.puntoVenta}` : null,
                c.letra ? `Factura ${c.letra}` : null]
                .filter(Boolean).join(' · ')}
            </p>
          )}
          {fila.cuentaCobro && (
            <p className="text-xs text-gray-400">
              Cuenta de cobro: {fila.cuentaCobro}
              {fila.imprimeFactura === true ? ' · imprime factura' : fila.imprimeFactura === false ? ' · no imprime factura' : ''}
            </p>
          )}

          {fila.pendientesHistoricos > 0 && (
            <p className="text-xs text-slate-600 mt-1">
              Quedaron {fila.pendientesHistoricos} pedidos de cuando esta cuenta sí se facturaba
              {fila.masViejoMs ? ` (el más viejo, del ${new Date(fila.masViejoMs).toLocaleDateString('es-AR')})` : ''}.
              No se procesan ni se borran: hay que decidir qué hacer con ellos.
            </p>
          )}

          {fila.esError && fila.mensaje && (
            <p className="text-xs text-red-700 mt-1">{fila.mensaje}</p>
          )}
          {fila.avisos?.length > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">{fila.avisos.join(' · ')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ColasFiscalesPanel() {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await radiografiaDelLocal());
    } catch (e) {
      setError(e?.message || String(e));
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
        <div>
          <p className="text-sm font-semibold text-gray-700">Cuentas fiscales por cola</p>
          <p className="text-xs text-gray-500">
            {datos
              ? `${datos.listas} de ${datos.configuradas} configuradas listas para facturar` +
                (datos.noFacturan?.length ? ` · ${datos.noFacturan.length} cuenta(s) que no facturan (generan remito)` : '') +
                (datos.conErrores?.length ? ` · ${datos.conErrores.length} con problemas` : '')
              : 'Cada FACTURACION_N es un contribuyente distinto'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}

      {datos?.conflictos?.length > 0 && (
        <div className="px-3 py-2 bg-red-50 border-b text-xs text-red-800">
          {datos.conflictos.map((c) => (
            <p key={c.cola}>
              <strong>{c.cola}</strong>: hay {c.cuentas.length} cuentas fiscales apuntando a la misma cola
              ({c.cuentas.join(', ')}). No se puede facturar hasta dejar una sola.
            </p>
          ))}
        </div>
      )}

      {datos?.identidadesDuplicadas?.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-b text-xs text-amber-900">
          {datos.identidadesDuplicadas.map((d) => (
            <p key={d.clave}>
              Mismo CUIT y punto de venta en {d.colas.join(' y ')}: son la misma identidad ante ARCA y
              comparten numeración. Revisá que sea intencional.
            </p>
          ))}
        </div>
      )}

      {datos?.cuentasSinCola?.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-b text-xs text-amber-900">
          {datos.cuentasSinCola.length} cuenta(s) fiscal(es) sin cola asignada: su “Ruta de la cola”
          tiene que terminar en FACTURACION_1 … FACTURACION_9.
        </div>
      )}

      <div>
        {cargando && !datos ? (
          <p className="px-3 py-4 text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Leyendo la configuración fiscal…
          </p>
        ) : (
          datos?.colas?.map((fila) => <FilaCola key={fila.cola} fila={fila} />)
        )}
      </div>
    </div>
  );
}
