
import React from 'react';
import SalesPercentageManager from '@/components/settings/local/admin/SalesPercentageManager.jsx';
import ClientImporter from '@/components/settings/local/admin/ClientImporter.jsx';
import LocalConfigurationForm from '@/components/settings/local/admin/LocalConfigurationForm.jsx';
import GridViewSettingsManager from '@/components/settings/local/admin/GridViewSettingsManager.jsx';
import CommissionPaymentManager from '@/components/settings/local/admin/CommissionPaymentManager.jsx';
import AppInfoManager from '@/components/settings/local/admin/AppInfoManager.jsx';
import ThemeSelector from '@/components/settings/local/admin/ThemeSelector.jsx';
import ProviderMigrationManager from '@/components/settings/local/admin/ProviderMigrationManager.jsx';
import LocalIdManager from '@/components/settings/local/admin/LocalIdManager.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const AdminPanel = ({ localId }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Panel de Administración</h2>
        <p className="text-muted-foreground">Configuraciones avanzadas y herramientas del sistema para {localId}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ThemeSelector />
        <AppInfoManager />
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <SalesPercentageManager />
        <GridViewSettingsManager />
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <CommissionPaymentManager />
        <ClientImporter />
      </div>
      
      <Separator />
      
      <div className="grid gap-6 md:grid-cols-2">
        <ProviderMigrationManager />
        <LocalIdManager />
      </div>

      <Separator />

      <Card className="border-red-200">
        <CardHeader className="bg-red-50/50">
          <CardTitle className="text-red-600">Configuración Crítica</CardTitle>
          <CardDescription>Ajustes de infraestructura. Modificar con precaución.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <LocalConfigurationForm />
        </CardContent>
      </Card>

    </div>
  );
};

export default AdminPanel;
