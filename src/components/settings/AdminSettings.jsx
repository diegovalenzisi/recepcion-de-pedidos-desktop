import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Lock, ShieldCheck } from 'lucide-react';
import { useAuth, verifyAdminPassword } from '@/hooks/useAuth';
import { processCommissionPayment } from '@/lib/api/settingsApi.js';
import { useCommissionBalance } from '@/hooks/useCommissionTotal.js';

import LocalIdManager from './local/admin/LocalIdManager.jsx';
import SalesPercentageManager from './local/admin/SalesPercentageManager.jsx';
import CommissionPaymentManager from './local/admin/CommissionPaymentManager.jsx';
import AppInfoManager from './local/admin/AppInfoManager.jsx';
import UpdateUploader from './local/admin/UpdateUploader.jsx';
import SystemHealthPanel from './local/admin/SystemHealthPanel.jsx';
import ClientImporter from './local/admin/ClientImporter.jsx';
import FacturacionManager from './local/admin/FacturacionManager.jsx';
import MpAccountsManager from './local/admin/MpAccountsManager.jsx';
import ThemeSelector from './local/admin/ThemeSelector.jsx';
import PeriodoPruebaManager from './local/admin/PeriodoPruebaManager.jsx';

// Re-confirmación de identidad DENTRO de la sesión ya iniciada (el login real
// sigue siendo useAuth/login). Se guarda en sessionStorage -no en localStorage-
// para que, igual que el resto de la sesión, no sobreviva a un reinicio de la
// app/Windows: quien reabra el programa vuelve a ver "Clave de Administrador".
const ADMIN_UNLOCK_KEY = 'adminPanelUnlocked';

const Seccion = ({ titulo, children }) => (
  <section className="space-y-4">
    <h3 className="text-xl font-bold tracking-tight text-gray-800 border-l-4 border-primary pl-3">
      {titulo}
    </h3>
    <div className="space-y-6">{children}</div>
  </section>
);

function AdminSettings({ settings, onSettingsChange, applySettings }) {
  const { user } = useAuth();
  const [desbloqueado, setDesbloqueado] = useState(
    () => sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1'
  );
  const [clave, setClave] = useState('');
  const [claveInvalida, setClaveInvalida] = useState(false);

  const commissionBalance = useCommissionBalance();
  const { totalGenerated, totalPaid, pending } = commissionBalance;

  const handleUnlock = (e) => {
    e.preventDefault();
    if (verifyAdminPassword(clave)) {
      sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
      setDesbloqueado(true);
      setClaveInvalida(false);
    } else {
      setClaveInvalida(true);
    }
    setClave('');
  };

  if (!desbloqueado) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="h-full flex items-center justify-center"
      >
        <Card className="w-full max-w-sm shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" /> Clave de Administrador
            </CardTitle>
            <CardDescription>Esta sección es exclusiva de {user?.usuario}.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUnlock} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="claveAdministrador">Clave</Label>
                <Input
                  id="claveAdministrador"
                  type="password"
                  autoComplete="off"
                  value={clave}
                  onChange={(e) => { setClave(e.target.value); setClaveInvalida(false); }}
                  autoFocus
                />
              </div>
              {claveInvalida && (
                <p className="text-sm text-red-500">Clave incorrecta.</p>
              )}
              <Button type="submit" className="w-full">Ingresar</Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full"
    >
      <Card className="shadow-2xl overflow-hidden mt-6 flex flex-col h-full">
        <CardHeader className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-6 flex-shrink-0">
          <CardTitle className="text-3xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-7 w-7" /> Administrador
          </CardTitle>
          <CardDescription className="text-gray-300">
            Configuraciones y herramientas exclusivas de administración del sistema.
          </CardDescription>
        </CardHeader>
        <div className="flex-grow overflow-y-auto overflow-x-auto">
          <CardContent className="p-8 space-y-10 min-w-[1100px]">

            <Seccion titulo="ID del Local">
              <LocalIdManager />
            </Seccion>

            <Separator />

            <Seccion titulo="Comisiones">
              <div className="grid gap-6 md:grid-cols-2">
                <SalesPercentageManager />
                <CommissionPaymentManager
                  accountTotals={{
                    totalCommission: totalGenerated,
                    totalPagado: totalPaid,
                    aPagar: pending,
                  }}
                  onProcessPayment={processCommissionPayment}
                />
              </div>
            </Seccion>

            <Separator />

            <Seccion titulo="App de Pedidos">
              <AppInfoManager settings={settings} onSettingsChange={onSettingsChange} />
              <UpdateUploader />
            </Seccion>

            <Separator />

            <SystemHealthPanel />

            <Separator />

            <ClientImporter />

            <Separator />

            <Seccion titulo="Facturación">
              <FacturacionManager />
            </Seccion>

            <Separator />

            <Seccion titulo="Mercado Pago">
              <MpAccountsManager />
            </Seccion>

            <Separator />

            <Seccion titulo="Temas de Aplicación">
              <ThemeSelector settings={settings} onSettingsChange={onSettingsChange} applySettings={applySettings} />
            </Seccion>

            <Separator />

            <Seccion titulo="Imagen para Pedido de Prueba">
              <PeriodoPruebaManager />
            </Seccion>

          </CardContent>
        </div>
      </Card>
    </motion.div>
  );
}

export default AdminSettings;
