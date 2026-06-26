import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, Key } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
    fetchMapsApiKey,
    fetchZonasVerdes,
    saveZonaVerde,
    updateZonaVerde,
    deleteZonaVerde,
    toggleZonaVerde,
} from '@/lib/api/mapsApi';
import ApiKeyConfig from './ApiKeyConfig';
import ZoneEditor from './ZoneEditor';
import ZonesList from './ZonesList';

function MapsSettings() {
    const { toast } = useToast();

    const [loading, setLoading]           = useState(true);
    const [apiKey, setApiKey]             = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null);
    const [zonas, setZonas]               = useState([]);
    const [editingZone, setEditingZone]   = useState(null);   // null = new, object = edit
    const [isEditorOpen, setIsEditorOpen] = useState(false);

    // ── Data loading ──────────────────────────────────────────────────────────

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null;

            const [keyFromDb, fetchedZonas] = await Promise.all([
                envKey ? Promise.resolve(null) : fetchMapsApiKey(),
                fetchZonasVerdes(),
            ]);

            if (!envKey) setApiKey(keyFromDb);
            setZonas(fetchedZonas);
        } catch (error) {
            console.error('Error loading maps data:', error);
            toast({
                variant: 'destructive',
                title: 'Error al cargar',
                description: 'No se pudo cargar la configuración de mapas.',
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleApiKeySaved = (key) => {
        setApiKey(key);
    };

    const handleNewZone = () => {
        setEditingZone(null);
        setIsEditorOpen(true);
    };

    const handleEditZone = (zona) => {
        setEditingZone(zona);
        setIsEditorOpen(true);
    };

    const handleCancelEdit = () => {
        setEditingZone(null);
        setIsEditorOpen(false);
    };

    const handleSaveZone = async (zona) => {
        try {
            if (editingZone?.id) {
                const updated = await updateZonaVerde(editingZone.id, zona);
                setZonas((prev) => prev.map((z) => z.id === editingZone.id ? { ...z, ...updated } : z));
                toast({ title: 'Zona actualizada', description: `"${zona.nombre}" fue actualizada correctamente.` });
            } else {
                const saved = await saveZonaVerde(zona);
                setZonas((prev) => [...prev, saved]);
                toast({ title: 'Zona guardada', description: `"${zona.nombre}" fue guardada correctamente.` });
            }
            setEditingZone(null);
            setIsEditorOpen(false);
        } catch (error) {
            console.error('Error saving zone:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la zona.' });
        }
    };

    const handleDeleteZone = async (zonaId) => {
        try {
            await deleteZonaVerde(zonaId);
            setZonas((prev) => prev.filter((z) => z.id !== zonaId));
            toast({ title: 'Zona eliminada', description: 'La zona fue eliminada correctamente.' });
            // Close editor if we deleted the zone being edited
            if (editingZone?.id === zonaId) {
                setEditingZone(null);
                setIsEditorOpen(false);
            }
        } catch (error) {
            console.error('Error deleting zone:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar la zona.' });
        }
    };

    const handleToggleZone = async (zonaId, activa) => {
        try {
            await toggleZonaVerde(zonaId, activa);
            setZonas((prev) => prev.map((z) => z.id === zonaId ? { ...z, activa } : z));
        } catch (error) {
            console.error('Error toggling zone:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo actualizar la zona.' });
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-5 p-4"
        >
            {/* Header */}
            <div className="flex items-start gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                    <MapPin className="h-5 w-5 text-green-700" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-gray-800">Zonas de Delivery</h2>
                    <p className="text-sm text-gray-500">
                        Definí las zonas donde realizás delivery dibujando polígonos en el mapa.
                        Estas zonas pueden usarse para validar si una dirección está dentro de la zona de reparto.
                    </p>
                </div>
            </div>

            {/* No API key → show config form */}
            {!apiKey ? (
                <ApiKeyConfig onKeySaved={handleApiKeySaved} />
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
                    {/* Left column: map editor */}
                    <div className="xl:col-span-2">
                        {isEditorOpen ? (
                            // key prop forces remount when switching between zones
                            <ZoneEditor
                                key={editingZone?.id ?? 'new'}
                                apiKey={apiKey}
                                editingZone={editingZone}
                                onSave={handleSaveZone}
                                onCancel={handleCancelEdit}
                            />
                        ) : (
                            <Card className="border-dashed border-2 border-gray-200 bg-gray-50/50">
                                <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
                                    <div className="p-4 bg-white rounded-full shadow-sm">
                                        <MapPin className="h-10 w-10 text-gray-300" />
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className="text-sm font-medium text-gray-600">Editor de zonas</p>
                                        <p className="text-xs text-gray-400">
                                            Creá una nueva zona o editá una existente desde la lista.
                                        </p>
                                    </div>
                                    <Button
                                        onClick={handleNewZone}
                                        className="bg-green-600 hover:bg-green-700 text-sm"
                                    >
                                        + Nueva Zona
                                    </Button>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Right column: zones list */}
                    <div className="xl:col-span-1">
                        <ZonesList
                            zonas={zonas}
                            onEdit={handleEditZone}
                            onDelete={handleDeleteZone}
                            onToggleActive={handleToggleZone}
                            onNewZone={handleNewZone}
                        />
                    </div>
                </div>
            )}

            {/* Footer note when API key comes from Firebase (not env var) */}
            {apiKey && !import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
                <p className="text-xs text-gray-400 flex items-center gap-1.5">
                    <Key className="h-3 w-3 flex-shrink-0" />
                    API Key cargada desde Firebase. Para mayor seguridad en producción, configurá la variable{' '}
                    <code className="bg-gray-100 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code>{' '}
                    en tu hosting.
                </p>
            )}
        </motion.div>
    );
}

export default MapsSettings;
