import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getOperationalDate, formatDateToDDMMAAAA } from '@/lib/utils';
import { Loader2, Smartphone, TrendingUp, Layers, Receipt } from 'lucide-react';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

const SalesByAppsPage = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pedidosYaDaily: 0,
    pedidosYaDailyCount: 0,
    pedidosYaAccumulated: 0,
    pedidosYaAccumulatedCount: 0,
    rappiDaily: 0,
    rappiDailyCount: 0,
    rappiAccumulated: 0,
    rappiAccumulatedCount: 0
  });

  useEffect(() => {
    const LOCAL_ID = getCurrentLocalId();
    if (!LOCAL_ID) {
      setLoading(false);
      return;
    }

    const db = getDatabase();
    const todayDDMMAAAA = formatDateToDDMMAAAA(getOperationalDate(new Date()));
    
    let pyLoaded = false;
    let rpLoaded = false;

    const checkLoading = () => {
      if (pyLoaded && rpLoaded) setLoading(false);
    };

    // Listen to PedidosYa Prepayments
    const pyRef = ref(db, `${LOCAL_ID}/PREPAGO_PEDIDOSYA`);
    const unsubPy = onValue(pyRef, (snapshot) => {
      let daily = 0;
      let dailyCount = 0;
      let accum = 0;
      let accumCount = 0;

      if (snapshot.exists()) {
        const data = snapshot.val();
        
        // Loop over dates or entries
        Object.entries(data).forEach(([key, value]) => {
          if (typeof value === 'object' && !value.monto) {
            // It's a date folder (like DDMMAAAA)
            const isToday = key === todayDDMMAAAA;
            Object.values(value).forEach(record => {
              const amount = Number(record.monto) || 0;
              accum += amount;
              accumCount += 1;
              if (isToday) {
                daily += amount;
                dailyCount += 1;
              }
            });
          } else {
            // Old structure fallback
            const amount = Number(value.monto) || 0;
            accum += amount;
            accumCount += 1;
          }
        });
      }
      
      setStats(prev => ({ 
        ...prev, 
        pedidosYaDaily: daily, 
        pedidosYaDailyCount: dailyCount,
        pedidosYaAccumulated: accum,
        pedidosYaAccumulatedCount: accumCount
      }));
      
      pyLoaded = true;
      checkLoading();
    }, (error) => {
      console.error("Error fetching PedidosYa prepayments:", error);
      pyLoaded = true;
      checkLoading();
    });

    // Listen to Rappi Prepayments
    const rpRef = ref(db, `${LOCAL_ID}/PREPAGO_RAPPI`);
    const unsubRp = onValue(rpRef, (snapshot) => {
      let daily = 0;
      let dailyCount = 0;
      let accum = 0;
      let accumCount = 0;

      if (snapshot.exists()) {
        const data = snapshot.val();
        
        Object.entries(data).forEach(([key, value]) => {
          if (typeof value === 'object' && !value.monto) {
            // It's a date folder
            const isToday = key === todayDDMMAAAA;
            Object.values(value).forEach(record => {
              const amount = Number(record.monto) || 0;
              accum += amount;
              accumCount += 1;
              if (isToday) {
                daily += amount;
                dailyCount += 1;
              }
            });
          } else {
            // Old structure fallback
            const amount = Number(value.monto) || 0;
            accum += amount;
            accumCount += 1;
          }
        });
      }
      
      setStats(prev => ({ 
        ...prev, 
        rappiDaily: daily, 
        rappiDailyCount: dailyCount,
        rappiAccumulated: accum,
        rappiAccumulatedCount: accumCount
      }));
      
      rpLoaded = true;
      checkLoading();
    }, (error) => {
      console.error("Error fetching Rappi prepayments:", error);
      rpLoaded = true;
      checkLoading();
    });

    return () => {
      unsubPy();
      unsubRp();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full min-h-[50vh]">
        <Loader2 className="w-16 h-16 animate-spin text-primary" />
      </div>
    );
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-4 container mx-auto"
    >
      <Helmet>
        <title>Ventas por Apps - DLV</title>
        <meta name="description" content="Totales diarios y acumulados de ventas por aplicaciones de delivery." />
      </Helmet>
      
      <div className="flex items-center space-x-3 mb-8">
        <Smartphone className="w-8 h-8 text-primary" />
        <h1 className="text-3xl font-bold text-gray-800">Ventas por Apps</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* PedidosYa Card */}
        <Card className="rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 border-t-4 border-t-[#EA044E]">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-bold text-gray-700 flex items-center justify-between">
              <span>PedidosYa</span>
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/PedidosYa_logo.svg/2048px-PedidosYa_logo.svg.png" 
                alt="PedidosYa" 
                className="h-8 object-contain"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mt-4 flex flex-col gap-6">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-500 font-medium uppercase tracking-wider flex items-center">
                    <TrendingUp className="w-4 h-4 mr-1 text-gray-400" /> Total del Día
                  </p>
                  <span className="text-xs font-semibold bg-[#EA044E]/10 text-[#EA044E] px-2 py-1 rounded-full flex items-center">
                    <Receipt className="w-3 h-3 mr-1" />
                    {stats.pedidosYaDailyCount} transacciones
                  </span>
                </div>
                <div className="flex items-end space-x-2 mt-2">
                  <span className="text-5xl font-extrabold text-[#EA044E]">
                    {formatCurrency(stats.pedidosYaDaily)}
                  </span>
                </div>
              </div>
              
              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1 uppercase tracking-wider flex items-center">
                    <Layers className="w-3 h-3 mr-1 text-gray-400" /> Acumulado General
                  </p>
                  <span className="text-2xl font-bold text-gray-700">
                    {formatCurrency(stats.pedidosYaAccumulated)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-medium mb-1 uppercase tracking-wider">
                    Total Mov.
                  </p>
                  <span className="text-lg font-semibold text-gray-500">
                    {stats.pedidosYaAccumulatedCount}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rappi Card */}
        <Card className="rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 border-t-4 border-t-[#FF441F]">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-bold text-gray-700 flex items-center justify-between">
              <span>Rappi</span>
              <img 
                src="https://images.crunchbase.com/image/upload/c_lpad,f_auto,q_auto:eco,dpr_1/v1500469089/yusxnt11hkskex9n2u8h.png" 
                alt="Rappi" 
                className="h-8 object-contain rounded-md"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mt-4 flex flex-col gap-6">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-gray-500 font-medium uppercase tracking-wider flex items-center">
                    <TrendingUp className="w-4 h-4 mr-1 text-gray-400" /> Total del Día
                  </p>
                  <span className="text-xs font-semibold bg-[#FF441F]/10 text-[#FF441F] px-2 py-1 rounded-full flex items-center">
                    <Receipt className="w-3 h-3 mr-1" />
                    {stats.rappiDailyCount} transacciones
                  </span>
                </div>
                <div className="flex items-end space-x-2 mt-2">
                  <span className="text-5xl font-extrabold text-[#FF441F]">
                    {formatCurrency(stats.rappiDaily)}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1 uppercase tracking-wider flex items-center">
                    <Layers className="w-3 h-3 mr-1 text-gray-400" /> Acumulado General
                  </p>
                  <span className="text-2xl font-bold text-gray-700">
                    {formatCurrency(stats.rappiAccumulated)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-medium mb-1 uppercase tracking-wider">
                    Total Mov.
                  </p>
                  <span className="text-lg font-semibold text-gray-500">
                    {stats.rappiAccumulatedCount}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
};

export default SalesByAppsPage;