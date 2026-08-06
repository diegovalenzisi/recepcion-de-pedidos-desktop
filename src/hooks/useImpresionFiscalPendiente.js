import { useEffect } from 'react';
import { vigilarImpresionesFiscales } from '@/lib/api/impresionFiscalApi';

/**
 * Mantiene viva la impresión automática de comprobantes fiscales.
 *
 * Va en App.jsx —no en la pantalla de mostrador— porque la factura puede salir
 * mucho después de la venta: el cajero ya cambió de pantalla, o cerró y volvió a
 * abrir la aplicación. Montado acá, cualquier terminal abierta recupera lo que
 * haya quedado pendiente, sin importar dónde esté parado el usuario.
 *
 * Si no hay ninguna terminal abierta, la impresión simplemente espera: el estado
 * vive en Firebase y se retoma cuando alguna vuelva a iniciarse.
 *
 * @param {boolean} activo  normalmente `!!user && !!localId`
 */
export function useImpresionFiscalPendiente(activo) {
  useEffect(() => {
    if (!activo) return undefined;
    const dejarDeVigilar = vigilarImpresionesFiscales({
      onEstado: ({ impresas }) => console.log(`[impresión fiscal] ${impresas} comprobante(s) impreso(s)`),
    });
    return dejarDeVigilar;
  }, [activo]);
}
