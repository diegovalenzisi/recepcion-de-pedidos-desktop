import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarClock, Loader2 } from 'lucide-react';

export default function ChangeDeliveryTimeModal({ isOpen, onOpenChange, order, onConfirm }) {
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [noTime, setNoTime] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && order) {
            // Attempt to parse order date to YYYY-MM-DD for input
            // Assuming order.date could be DD-MM-YYYY (common) or YYYY-MM-DD
            let formattedDate = '';
            if (order.date) {
                if (order.date.includes('/')) {
                     // Handle DD/MM/YYYY
                     const parts = order.date.split('/');
                     if (parts.length === 3) {
                        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                     }
                } else if (order.date.includes('-')) {
                    const parts = order.date.split('-');
                    if (parts[0].length === 4) {
                        // Already YYYY-MM-DD
                        formattedDate = order.date; 
                    } else if (parts.length === 3) {
                         // Assume DD-MM-YYYY
                         formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
            }
            setDate(formattedDate);
            
            // Set time logic: if exists, use it; otherwise enable "no time" checkbox
            if (order.hora) {
                setTime(order.hora.substring(0, 5));
                setNoTime(false);
            } else {
                setTime('');
                setNoTime(true);
            }
        }
    }, [isOpen, order]);

    const handleSave = async () => {
        setLoading(true);
        try {
            // Prepare date to send back. Ideally preserve the system's format.
            // If the original date was DD-MM-YYYY, we should convert back to that.
            let dateToSend = date;
            
            // Check original format from order if available
            const originalWasDDMM = order?.date && order.date.split('-')[0].length === 2;
            
            if (date.includes('-')) {
                 const parts = date.split('-');
                 if (parts[0].length === 4 && originalWasDDMM) { 
                     // Input is YYYY-MM-DD, convert back to DD-MM-YYYY
                     dateToSend = `${parts[2]}-${parts[1]}-${parts[0]}`;
                 }
            }

            // Ensure time has seconds if originally present or just HH:mm
            let timeToSend = time;
            
            if (noTime) {
                timeToSend = null;
            } else {
                 if (time.length === 5) {
                    timeToSend = `${time}:00`;
                }
            }

            await onConfirm(dateToSend, timeToSend);
            onOpenChange(false);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5 text-cyan-600" />
                        Cambiar Horario de Entrega
                    </DialogTitle>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="date" className="text-right">
                            Fecha
                        </Label>
                        <Input
                            id="date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="time" className="text-right pt-2">
                            Hora
                        </Label>
                        <div className="col-span-3 space-y-2">
                            <Input
                                id="time"
                                type="time"
                                value={time}
                                onChange={(e) => {
                                    setTime(e.target.value);
                                    if (e.target.value) setNoTime(false);
                                }}
                                disabled={noTime}
                            />
                            <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="noTime" 
                                    checked={noTime} 
                                    onCheckedChange={(checked) => {
                                        setNoTime(checked);
                                        if (checked) setTime('');
                                    }}
                                />
                                <Label htmlFor="noTime" className="text-sm text-muted-foreground cursor-pointer font-normal">
                                    Sin hora programada
                                </Label>
                            </div>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={loading} className="bg-cyan-600 hover:bg-cyan-700">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar Cambios
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}