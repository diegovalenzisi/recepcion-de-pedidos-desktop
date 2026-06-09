import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Pencil, Trash2, MapPin, Plus } from 'lucide-react';

function ZonesList({ zonas, onEdit, onDelete, onToggleActive, onNewZone }) {
    const [deletingId, setDeletingId] = useState(null);

    const handleConfirmDelete = async (zonaId) => {
        setDeletingId(zonaId);
        try {
            await onDelete(zonaId);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <Card className="flex flex-col h-full">
            <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-green-600" />
                        Zonas guardadas
                        {zonas.length > 0 && (
                            <Badge variant="secondary" className="text-xs font-normal">
                                {zonas.length}
                            </Badge>
                        )}
                    </CardTitle>
                    <Button
                        size="sm"
                        onClick={onNewZone}
                        className="h-7 text-xs bg-green-600 hover:bg-green-700 px-3"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        Nueva
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-3 pt-0">
                {zonas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 space-y-2 pt-4">
                        <MapPin className="h-8 w-8 opacity-40" />
                        <p className="text-sm text-center leading-snug">
                            No hay zonas guardadas.<br />
                            Dibujá tu primera zona en el mapa.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-1.5 overflow-y-auto max-h-[440px] pr-0.5">
                        {zonas.map((zona) => {
                            const isActive = zona.activa !== false;
                            const isDeleting = deletingId === zona.id;

                            return (
                                <div
                                    key={zona.id}
                                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                                        isActive
                                            ? 'bg-white border-gray-100 hover:bg-gray-50'
                                            : 'bg-gray-50 border-gray-100 opacity-60'
                                    }`}
                                >
                                    {/* Color dot */}
                                    <div
                                        className="w-3 h-3 rounded-full flex-shrink-0 border border-white shadow-sm"
                                        style={{ backgroundColor: zona.color || '#22c55e' }}
                                    />

                                    {/* Name + point count */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate leading-tight">
                                            {zona.nombre}
                                        </p>
                                        <p className="text-xs text-gray-400 leading-tight">
                                            {zona.puntos?.length ?? 0} puntos
                                        </p>
                                    </div>

                                    {/* Active toggle */}
                                    <Switch
                                        checked={isActive}
                                        onCheckedChange={(checked) => onToggleActive(zona.id, checked)}
                                        title={isActive ? 'Desactivar zona' : 'Activar zona'}
                                        className="scale-75 flex-shrink-0"
                                    />

                                    {/* Edit button */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 flex-shrink-0 text-gray-400 hover:text-primary hover:bg-primary/10"
                                        onClick={() => onEdit(zona)}
                                        title="Editar zona"
                                        disabled={isDeleting}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>

                                    {/* Delete button with confirmation */}
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 flex-shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                title="Eliminar zona"
                                                disabled={isDeleting}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    ¿Eliminar la zona "{zona.nombre}"?
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Esta acción es irreversible. La zona será eliminada permanentemente
                                                    de la base de datos y no podrá recuperarse.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleConfirmDelete(zona.id)}
                                                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                                                >
                                                    Eliminar
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default ZonesList;
