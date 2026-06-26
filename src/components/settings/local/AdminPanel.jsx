
import React, { useState, useEffect, useCallback } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { fetchCommissionTotals, processCommissionPayment } from '@/lib/api/settingsApi.js';

const AdminPanel = ({ localId, settings, onSettingsChange, applySettings }) => {
  const [commissionTotals, setCommissionTotals] = useState({ aPagar: 0, pagado: 0 });

  const loadCommissionTotals = useCallback(async () => {
    try {
      const totals = await fetchCommissionTotals();
      setCommissionTotals(totals);
    } catch (error) {
      console.error('Error al cargar totales de comisiones:', error);
    }
  }, []);

  useEffect(() => {
    loadCommissionTotals();
  }, [loadCommissionTotals]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Panel de Administración</h2>
        <p className="text-muted-foreground">Configuraciones avanzadas y herramientas del sistema para {localId}</p>
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
            totalCommission: commissionTotals.generado,  // bruto histórico
            totalPagado:     commissionTotals.pagado,
            aPagar:          commissionTotals.aPagar,    // TotalComisionAPagar
          }}
          onProcessPayment={processCommissionPayment}
          onPaymentSuccess={loadCommissionTotals}
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

      <LocalNewManager />

    </div>
  );
};

export default AdminPanel;
