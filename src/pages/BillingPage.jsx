import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { FileText, Loader2, AlertTriangle } from 'lucide-react';
import { fetchBillingData } from '@/lib/api/billingApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';

const BillingPage = () => {
  const [billingData, setBillingData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await fetchBillingData();
        setBillingData(data);
      } catch (err) {
        setError('No se pudieron cargar los datos de facturación. Por favor, inténtelo de nuevo más tarde.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(value);
  };

  return (
    <>
      <Helmet>
        <title>Facturación | DLV Sistemas</title>
        <meta name="description" content="Gestión de facturación y comprobantes." />
      </Helmet>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="container mx-auto p-0 sm:p-2 lg:p-4 h-full flex flex-col"
      >
        <Card className="flex-grow flex flex-col">
          <CardHeader>
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-primary/10 rounded-md">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle>Módulo de Facturación</CardTitle>
                <p className="text-sm text-gray-500">Visualiza todos los comprobantes de ventas emitidos.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-grow flex flex-col p-0">
            {loading ? (
              <div className="flex-grow flex items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="flex-grow flex flex-col items-center justify-center text-center text-red-600">
                <AlertTriangle className="h-12 w-12 mb-4" />
                <p className="text-lg font-semibold">Error al cargar los datos</p>
                <p>{error}</p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-gray-50 z-10">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Hora</TableHead>
                      <TableHead>N° Factura</TableHead>
                      <TableHead>Modo de Venta</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingData.length > 0 ? (
                      billingData.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>{invoice.fecha}</TableCell>
                          <TableCell>{invoice.hora}</TableCell>
                          <TableCell className="font-medium">{invoice.numeroFactura}</TableCell>
                          <TableCell>{invoice.modo}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(invoice.importe)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan="5" className="text-center h-24">
                          No se encontraron registros de facturación.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </>
  );
};

export default BillingPage;