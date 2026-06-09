import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Shield } from 'lucide-react';
import { saveToSafe } from '@/lib/api/cash';
import { fetchEmployees } from '@/lib/api/hrApi';
import { printSafeTicket } from '@/lib/print.js';

const SafeModal = ({ isOpen, onClose, shift }) => {
    const [amount, setAmount] = useState('');
    const [responsible, setResponsible] = useState('');
    const [sellers, setSellers] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (isOpen) {
            const getSellers = async () => {
                setIsLoading(true);
                try {
                    const employees = await fetchEmployees();
                    const sellerEmployees = employees.filter(emp => emp.categoriaNombre && emp.categoriaNombre.toLowerCase() === 'vendedor');
                    setSellers(sellerEmployees);
                    if (sellerEmployees.length === 0) {
                        toast({ variant: 'default', title: 'Aviso', description: 'No se encontraron empleados con la categoría "Vendedor".' });
                    }
                } catch (error) {
                    console.error("Error fetching employees:", error);
                    toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los empleados.' });
                } finally {
                    setIsLoading(false);
                }
            };
            getSellers();
        } else {
            setAmount('');
            setResponsible('');
        }
    }, [isOpen, toast]);

    const handleSave = async () => {
        if (!amount || !responsible || isNaN(parseFloat(amount))) {
            toast({ variant: 'destructive', title: 'Datos incompletos', description: 'Por favor, complete todos los campos.' });
            return;
        }

        setIsLoading(true);
        try {
            const safeData = {
                valor: parseFloat(amount),
                responsable: responsible
            };
            
            const { nextId, dataToSave } = await saveToSafe(shift, safeData, false);

            await printSafeTicket({
                drawNumber: nextId,
                date: dataToSave.fechacaja,
                time: dataToSave.hora,
                shiftId: shift.id,
                responsible: dataToSave.responsable,
                value: dataToSave.valor,
            });

            await saveToSafe(shift, safeData, true);

            toast({ title: 'Éxito', description: 'Movimiento en caja fuerte registrado correctamente.' });
            onClose();
        } catch (error) {
            console.error("Error saving to safe:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar el movimiento.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center"><Shield className="mr-2"/>Caja Fuerte - Turno #{shift?.id}</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div>
                        <Label htmlFor="amount">Valor</Label>
                        <Input 
                            id="amount" 
                            type="number" 
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="Ingrese el monto"
                        />
                    </div>
                    <div>
                        <Label htmlFor="responsible">Responsable</Label>
                        <Select onValueChange={setResponsible} value={responsible}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccione un responsable" />
                            </SelectTrigger>
                            <SelectContent>
                                {sellers.map(seller => (
                                    <SelectItem key={seller.legajo} value={`${seller.nombre} ${seller.apellido}`}>
                                        {seller.nombre} {seller.apellido}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default SafeModal;