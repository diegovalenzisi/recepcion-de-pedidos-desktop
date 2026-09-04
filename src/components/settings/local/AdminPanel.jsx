
import React from 'react';
import SalesPercentageManager from '@/components/settings/local/admin/SalesPercentageManager.jsx';
import ClientImporter from '@/components/settings/local/admin/ClientImporter.jsx';
import GridViewSettingsManager from '@/components/settings/local/admin/GridViewSettingsManager.jsx';
import CommissionPaymentManager from '@/components/settings/local/admin/CommissionPaymentManager.jsx';
import AppInfoManager from '@/components/settings/local/admin/AppInfoManager.jsx';
import ThemeSelector from '@/components/settings/local/admin/ThemeSelector.jsx';
import LocalIdManager from '@/components/settings/local/admin/LocalIdManager.jsx';
import MpAccountsManager from '@/components/settings/local/admin/MpAccountsManager.jsx';
import UpdateUploader from '@/components/settings/local/admin/UpdateUploader.jsx';
import FacturacionManager from '@/components/settings/local/admin/FacturacionManager.jsx';
import SystemHealthPanel from '@/components/settings/local/admin/SystemHealthPanel.jsx';
import LocalNewManager from '@/components/settings/local/admin/LocalNewManager.jsx';
import PeriodoPruebaManager from '@/components/settings/local/admin/PeriodoPruebaManager.jsx';
import { Separator } from '@/components/ui/separator';
import { processCommissionPayment } from '@/lib/api/settingsApi.js';
import { useCommissionBalance } from '@/hooks/useCommissionTotal.js';

const AdminPanel = ({ settings, onSettingsChange, applySettings }) => {
  // Misma fuente y mismo cálculo que el footer y el aviso al entrar (useCommissionBalance,
  // que envuelve COMISIONES/REGISTRO − COMISIONES/PAGOS). Ya NO se usa fetchCommissionTotals
  // (RESUMEN_CUENTA/TOTALES + PAGOS_COMISIONES), el ledger viejo que podía desincronizarse
  // — ver diagnóstico de Centenario. Solo lectura: no cambia cómo se registra un pago
  // (processCommissionPayment sigue igual, sin tocar).
  //
  // Antes recibía un prop `localId` que nunca llegaba (SettingsPage.jsx -> LocalSettings.jsx
  // no lo pasaba), así que `!!localId` siempre daba false y el hook devolvía pending:0 en
  // la app compilada aunque el footer (que usa su propio localId en App.jsx) mostraba el
  // valor correcto. useCommissionBalance() ya resuelve el local activo internamente
  // (getCurrentLocalId), por eso se llama sin argumento y sin depender de ese prop.
  const commissionBalance = useCommissionBalance();
  const { totalGenerated, totalPaid, pending } = commissionBalance;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Panel de Administración</h2>
        <p className="text-muted-foreground">Configuraciones avanzadas y herramientas del sistema</p>
      </div>

      <SystemHealthPanel />

      <div className="grid gap-6 md:grid-cols-2">
        <ThemeSelector settings={settings} onSettingsChange={onSettingsChange} applySettings={applySettings} />
        <AppInfoManager settings={settings} onSettingsChange={onSettingsChange} />
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <SalesPercentageManager />
        <GridViewSettingsManager />
      </div>

      <Separator />

      <UpdateUploader />

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <CommissionPaymentManager
          accountTotals={{
            totalCommission: totalGenerated, // COMISIONES/REGISTRO válido
            totalPagado:     totalPaid,      // COMISIONES/PAGOS aprobado
            aPagar:          pending,        // totalGenerated − totalPaid, nunca negativo
          }}
          onProcessPayment={processCommissionPayment}
        />
        <ClientImporter />
      </div>
      
      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <LocalIdManager />
      </div>

      <Separator />

      <MpAccountsManager />

      <Separator />

      <FacturacionManager />

      <Separator />

      {/* Período de prueba y "Local nuevo" son operaciones DISTINTAS:
          una conserva el local y limpia la actividad, la otra prepara la PC
          para otro comercio. Van separadas a propósito. */}
      <PeriodoPruebaManager />

      <Separator />

      <LocalNewManager />

    </div>
  );
};

export default AdminPanel;
