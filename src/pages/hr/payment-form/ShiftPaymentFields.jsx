import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sun, Coffee, Moon, DollarSign } from 'lucide-react';

const ShiftPaymentFields = ({ formData, handleShiftChange, totalShiftPayment, error, employee }) => {
    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
    };

    if (!employee) {
        return <div className="p-4 border rounded-lg bg-yellow-50 text-yellow-800 text-center">Selecciona un empleado para ver sus opciones de turno.</div>
    }

    return (
        <>
            <div className="p-3 border rounded-lg space-y-3">
                <h3 className="font-semibold text-sm mb-1">Seleccionar Turnos Trabajados</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="flex items-center space-x-2 p-2 border rounded-md">
                        <Checkbox id="manana" checked={formData.turnos.manana} onCheckedChange={() => handleShiftChange('manana')} />
                        <Label htmlFor="manana" className="flex items-center gap-2 cursor-pointer">
                            <Sun className="h-4 w-4 text-yellow-500" />
                            <span>Mañana ({formatCurrency(employee.valorTurnoManana)})</span>
                        </Label>
                    </div>
                    <div className="flex items-center space-x-2 p-2 border rounded-md">
                        <Checkbox id="tarde" checked={formData.turnos.tarde} onCheckedChange={() => handleShiftChange('tarde')} />
                        <Label htmlFor="tarde" className="flex items-center gap-2 cursor-pointer">
                            <Coffee className="h-4 w-4 text-orange-500" />
                            <span>Tarde ({formatCurrency(employee.valorTurnoTarde)})</span>
                        </Label>
                    </div>
                    <div className="flex items-center space-x-2 p-2 border rounded-md">
                        <Checkbox id="noche" checked={formData.turnos.noche} onCheckedChange={() => handleShiftChange('noche')} />
                        <Label htmlFor="noche" className="flex items-center gap-2 cursor-pointer">
                            <Moon className="h-4 w-4 text-blue-500" />
                            <span>Noche ({formatCurrency(employee.valorTurnoNoche)})</span>
                        </Label>
                    </div>
                </div>
            </div>
            {error && <p className="text-red-500 text-xs text-center">{error}</p>}
            <div className="mt-2 p-2 bg-orange-50 rounded-lg flex justify-around items-center">
                <div className="text-center">
                    <div className="flex items-center text-gray-600 text-xs">
                        <DollarSign className="h-3 w-3 mr-1" />
                        <span className="font-medium">Total a Pagar</span>
                    </div>
                    <p className="text-lg font-bold text-green-600">{formatCurrency(totalShiftPayment)}</p>
                </div>
            </div>
        </>
    );
};

export default ShiftPaymentFields;