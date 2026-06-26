import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchAccountSummary } from '@/lib/api/myAccountApi';
import { Loader2, ShoppingCart, Truck } from 'lucide-react';

const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
    }).format(value || 0);
};

const MyAccountPage = () => {
    const [summary, setSummary] = useState({ totals: { totalSales: 0, totalCommission: 0 }, transactions: [] });
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchAccountSummary();
            setSummary(data);
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error al cargar el resumen',
                description: 'No se pudo obtener la información de la cuenta.',
            });
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);
    
    useEffect(() => {
        const handleCommissionPaid = () => {
            loadData();
        };

        window.addEventListener('commissionPaid', handleCommissionPaid);

        return () => {
            window.removeEventListener('commissionPaid', handleCommissionPaid);
        };
    }, [loadData]);

    const renderOrderTypeIcon = (type) => {
        switch (type) {
            case 'mostrador':
                return <ShoppingCart className="h-5 w-5 text-green-500" />;
            case 'delivery':
                return <Truck className="h-5 w-5 text-red-500" />;
            default:
                return null;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="p-4"
        >
            <Card className="shadow-2xl">
                <header className="bg-blue-600 text-white p-6 rounded-t-lg">
                    <h1 className="text-3xl font-bold">Resumen de Cuenta</h1>
                    <p className="text-blue-200 mt-1">Ventas y comisiones acumuladas desde el último pago.</p>
                    <div className="flex justify-end items-baseline space-x-8 mt-4">
                        <div className="text-right">
                            <p className="text-sm text-blue-200">Venta Total</p>
                            <p className="text-4xl font-semibold">{formatCurrency(summary.totals.totalSales)}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-blue-200">Comisión Total</p>
                            <p className="text-4xl font-semibold text-green-300">{formatCurrency(summary.totals.totalCommission)}</p>
                        </div>
                    </div>
                </header>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>
                                    <TableHead className="w-[120px] text-gray-600">Fecha</TableHead>
                                    <TableHead className="text-gray-600"># N° Pedido</TableHead>
                                    <TableHead className="text-gray-600">Tipo</TableHead>
                                    <TableHead className="text-right text-gray-600">$ Valor</TableHead>
                                    <TableHead className="text-right text-gray-600">Comisión</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {summary.transactions.length > 0 ? (
                                    summary.transactions.map((tx) => (
                                        <TableRow key={tx.id} className="hover:bg-gray-50">
                                            <TableCell className="font-medium">{tx.fecha}</TableCell>
                                            <TableCell>{tx.numero}</TableCell>
                                            <TableCell>{renderOrderTypeIcon(tx.tipo)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(tx.valor)}</TableCell>
                                            <TableCell className="text-right font-semibold text-green-600">{formatCurrency(tx.comision)}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan="5" className="text-center text-gray-500 py-8">
                                            No hay transacciones para mostrar.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
};

export default MyAccountPage;