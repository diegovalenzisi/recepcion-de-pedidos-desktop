// ---------------------------------------------------------------------------
// EL SWITCH DE FACTURACIÓN DE ESTA PC
//
// Es UNA decisión para toda la computadora: "esta PC factura" o "no factura".
// Por eso se aplica a TODAS las cuentas fiscales del local a la vez, y se lee
// como apagado si alguna quedó apagada expresamente.
//
// La regla, igual que en el arranque:
//     campo ausente  → ON  (toda PC factura por defecto)
//     true           → ON
//     false          → OFF, y se respeta en todos los arranques siguientes
//
// El valor vive SOLO en el archivo local de esta PC: `facturacionAutomatica`
// está en LOCAL_ONLY_FIELDS (afipConfigApi.js), así que apagar una computadora
// no apaga las demás del mismo local.
//
// Módulo puro para poder probarlo sin React.
// ---------------------------------------------------------------------------

/** Todas las cuentas fiscales de un config, sea RI o monotributo. */
export function cuentasFiscales(cfg) {
  const lista = [];
  if (cfg?.ri && typeof cfg.ri === 'object') lista.push(cfg.ri);
  for (const c of (cfg?.monotributo?.cuentas || [])) {
    if (c && typeof c === 'object') lista.push(c);
  }
  return lista;
}

/**
 * ¿Esta PC está facturando? Sin cuentas configuradas se considera ON: el switch
 * no tiene por qué mostrarse apagado en una PC que todavía no configuró nada.
 */
export function facturacionActivaEnEstaPC(cfg) {
  const cuentas = cuentasFiscales(cfg);
  if (cuentas.length === 0) return true;
  return !cuentas.some((c) => c?.facturacionAutomatica === false);
}

/** Aplica el switch a TODAS las cuentas. Devuelve un config nuevo; no muta. */
export function aplicarSwitchFacturacion(cfg, encendido) {
  const valor = encendido === true;
  const marcar = (nodo) => ({ ...nodo, facturacionAutomatica: valor });
  const out = { ...(cfg || {}) };
  if (out.ri) out.ri = marcar(out.ri);
  if (out.monotributo?.cuentas) {
    out.monotributo = { ...out.monotributo, cuentas: out.monotributo.cuentas.map(marcar) };
  }
  return out;
}

/** Claves de proceso que hay que arrancar o detener al mover el switch. */
export function clavesDeProceso(cfg) {
  if (cfg?.tipo === 'responsable_inscripto') return cfg.ri ? ['ri'] : [];
  return (cfg?.monotributo?.cuentas || []).map((c) => `mono_${c.id}`);
}
