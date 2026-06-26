import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Key, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { saveMapsApiKey } from '@/lib/api/mapsApi';

function ApiKeyConfig({ onKeySaved }) {
    const { toast } = useToast();
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);

    // If env var is set, show read-only notice and auto-activate
    if (import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
        return (
            <Card className="border-green-200 bg-green-50">
                <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm font-medium">
                            API Key configurada mediante variable de entorno{' '}
                            <code className="bg-green-100 px-1 rounded text-xs">VITE_GOOGLE_MAPS_API_KEY</code>.
                        </span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const handleSave = async () => {
        if (!apiKey.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'Ingresá una API Key válida.' });
            return;
        }
        setSaving(true);
        try {
            await saveMapsApiKey(apiKey.trim());
            toast({ title: 'API Key guardada', description: 'La configuración de Google Maps fue guardada correctamente.' });
            onKeySaved(apiKey.trim());
        } catch (error) {
            console.error('Error saving maps API key:', error);
            toast({ variant: 'destructive', title: 'Error al guardar', description: 'No se pudo guardar la API Key. Intentá de nuevo.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="max-w-xl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="h-5 w-5 text-primary" />
                    Configurar Google Maps
                </CardTitle>
                <CardDescription>
                    Para usar el editor de zonas necesitás una API Key de Google Maps con la{' '}
                    <strong>Maps JavaScript API</strong> habilitada en Google Cloud Console.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="maps-api-key">Google Maps API Key</Label>
                    <Input
                        id="maps-api-key"
                        type="text"
                        placeholder="AIzaSy..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        className="font-mono text-sm"
                        autoComplete="off"
                    />
                </div>

                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                        <p className="font-semibold">Aviso de seguridad</p>
                        <p>
                            La API Key se guarda en Firebase para uso interno del sistema.
                            En producción, configurá la variable{' '}
                            <code className="bg-amber-100 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code>{' '}
                            en tu hosting para mayor seguridad.
                        </p>
                    </div>
                </div>

                <Button
                    onClick={handleSave}
                    disabled={saving || !apiKey.trim()}
                    className="w-full"
                >
                    {saving
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                        : <><Key className="h-4 w-4 mr-2" />Guardar y activar mapa</>
                    }
                </Button>
            </CardContent>
        </Card>
    );
}

export default ApiKeyConfig;
