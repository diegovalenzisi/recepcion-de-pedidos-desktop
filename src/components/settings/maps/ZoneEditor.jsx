import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Trash2, X, MapPin, Undo2, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// ─── Constants ───────────────────────────────────────────────────────────────

const ZONE_COLORS = [
    { label: 'Verde',   value: '#22c55e' },
    { label: 'Azul',    value: '#3b82f6' },
    { label: 'Naranja', value: '#f97316' },
    { label: 'Rojo',    value: '#ef4444' },
    { label: 'Violeta', value: '#8b5cf6' },
    { label: 'Amarillo',value: '#eab308' },
];

// Default map center: Buenos Aires
const DEFAULT_CENTER = { lat: -34.6037, lng: -58.3816 };

// ─── Script loader (module-level so it persists across remounts) ─────────────

let mapsLoadPromise = null;

const loadGoogleMapsScript = (apiKey) => {
    if (window.google?.maps?.Map) return Promise.resolve();
    if (mapsLoadPromise) return mapsLoadPromise;

    mapsLoadPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById('google-maps-api');
        if (existing) {
            // Script tag exists but may still be loading — poll
            const poll = setInterval(() => {
                if (window.google?.maps?.Map) { clearInterval(poll); resolve(); }
            }, 150);
            return;
        }
        const script = document.createElement('script');
        script.id = 'google-maps-api';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => {
            mapsLoadPromise = null;
            reject(new Error('No se pudo cargar Google Maps. Verificá que la API Key sea válida y que la Maps JavaScript API esté habilitada.'));
        };
        document.head.appendChild(script);
    });

    return mapsLoadPromise;
};

// ─── Component ───────────────────────────────────────────────────────────────

function ZoneEditor({ apiKey, editingZone, onSave, onCancel }) {
    const { toast } = useToast();

    // Map refs — imperative Google Maps objects
    const mapContainerRef  = useRef(null);
    const mapInstanceRef   = useRef(null);
    const polygonRef       = useRef(null);
    const polylineRef      = useRef(null);
    const markersRef       = useRef([]);
    const clickListenerRef = useRef(null);

    // Component state
    const [mapsLoaded, setMapsLoaded] = useState(false);
    const [mapsError, setMapsError]   = useState(null);
    const [points, setPoints]         = useState([]);
    const [nombre, setNombre]         = useState('');
    const [color, setColor]           = useState('#22c55e');
    const [saving, setSaving]         = useState(false);

    // ── 1. Pre-fill form when editing an existing zone (runs once on mount) ──
    useEffect(() => {
        if (editingZone) {
            setNombre(editingZone.nombre || '');
            setColor(editingZone.color || '#22c55e');
            setPoints(editingZone.puntos || []);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 2. Load Google Maps script ────────────────────────────────────────────
    useEffect(() => {
        if (window.google?.maps?.Map) { setMapsLoaded(true); return; }
        loadGoogleMapsScript(apiKey)
            .then(() => setMapsLoaded(true))
            .catch((err) => setMapsError(err.message));
    }, [apiKey]);

    // ── 3. Initialize map once script is ready ────────────────────────────────
    useEffect(() => {
        if (!mapsLoaded || !mapContainerRef.current || mapInstanceRef.current) return;

        const center = editingZone?.puntos?.[0] ?? DEFAULT_CENTER;

        const map = new window.google.maps.Map(mapContainerRef.current, {
            center,
            zoom: 13,
            mapTypeId: 'roadmap',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
        });

        mapInstanceRef.current = map;

        clickListenerRef.current = map.addListener('click', (e) => {
            const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            setPoints((prev) => [...prev, point]);
        });
    }, [mapsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 4. Update map visuals whenever points or color change ─────────────────
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !mapsLoaded) return;

        // Remove previous overlays
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        if (polygonRef.current)  { polygonRef.current.setMap(null);  polygonRef.current  = null; }
        if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }

        if (points.length === 0) return;

        // Draw a numbered marker for each point
        points.forEach((point, index) => {
            const marker = new window.google.maps.Marker({
                position: point,
                map,
                label: {
                    text: String(index + 1),
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: '11px',
                },
                icon: {
                    path: window.google.maps.SymbolPath.CIRCLE,
                    scale: 11,
                    fillColor: color,
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                },
                zIndex: 10,
            });
            markersRef.current.push(marker);
        });

        if (points.length >= 3) {
            // Filled closed polygon
            polygonRef.current = new window.google.maps.Polygon({
                paths: points,
                strokeColor: color,
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: color,
                fillOpacity: 0.25,
                map,
                zIndex: 5,
            });
        } else if (points.length === 2) {
            // Simple line between 2 points
            polylineRef.current = new window.google.maps.Polyline({
                path: points,
                geodesic: true,
                strokeColor: color,
                strokeOpacity: 0.9,
                strokeWeight: 2,
                map,
                zIndex: 5,
            });
        }
    }, [points, color, mapsLoaded]);

    // ── 5. Cleanup on unmount ─────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            markersRef.current.forEach((m) => m.setMap(null));
            if (polygonRef.current)  polygonRef.current.setMap(null);
            if (polylineRef.current) polylineRef.current.setMap(null);
            if (mapInstanceRef.current && clickListenerRef.current) {
                window.google.maps.event.removeListener(clickListenerRef.current);
            }
            mapInstanceRef.current = null;
        };
    }, []);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleUndoLastPoint = () => setPoints((prev) => prev.slice(0, -1));
    const handleClearPoints   = () => setPoints([]);

    const handleSave = async () => {
        if (!nombre.trim()) {
            toast({ variant: 'destructive', title: 'Nombre requerido', description: 'Ingresá un nombre para la zona.' });
            return;
        }
        if (points.length < 3) {
            toast({ variant: 'destructive', title: 'Puntos insuficientes', description: 'Una zona necesita al menos 3 puntos.' });
            return;
        }
        setSaving(true);
        try {
            await onSave({
                nombre: nombre.trim(),
                activa: editingZone?.activa !== false,
                color,
                puntos: points,
            });
        } finally {
            setSaving(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (mapsError) {
        return (
            <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-5">
                    <div className="flex items-start gap-3 text-red-700">
                        <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <p className="font-semibold text-sm">Error al cargar Google Maps</p>
                            <p className="text-xs text-red-600">{mapsError}</p>
                            <p className="text-xs text-gray-500 mt-1">
                                Verificá que la API Key sea válida y que la{' '}
                                <strong>Maps JavaScript API</strong> esté habilitada en Google Cloud Console.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const isValid = nombre.trim().length > 0 && points.length >= 3;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-green-600" />
                    {editingZone ? `Editando: ${editingZone.nombre}` : 'Nueva Zona de Delivery'}
                </CardTitle>
                <CardDescription className="text-xs">
                    Hacé clic en el mapa para agregar vértices al polígono. Mínimo 3 puntos para guardar.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
                {/* Map container */}
                <div className="relative rounded-md overflow-hidden border border-gray-200">
                    {!mapsLoaded && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 z-10 gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                            <span className="text-sm text-gray-500">Cargando mapa...</span>
                        </div>
                    )}
                    <div
                        ref={mapContainerRef}
                        className="w-full"
                        style={{ height: '360px' }}
                    />
                </div>

                {/* Points status bar */}
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <Badge
                            variant={points.length >= 3 ? 'default' : 'secondary'}
                            className="text-xs"
                        >
                            {points.length} punto{points.length !== 1 ? 's' : ''}
                        </Badge>
                        {points.length > 0 && points.length < 3 && (
                            <span className="text-amber-600 text-xs">
                                Faltan {3 - points.length} más para cerrar la zona
                            </span>
                        )}
                        {points.length >= 3 && (
                            <span className="text-green-600 text-xs font-medium">✓ Zona válida</span>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleUndoLastPoint}
                            disabled={points.length === 0}
                            className="h-7 text-xs text-gray-500 hover:text-gray-700 px-2"
                            title="Quitar último punto"
                        >
                            <Undo2 className="h-3 w-3 mr-1" /> Deshacer
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleClearPoints}
                            disabled={points.length === 0}
                            className="h-7 text-xs text-red-500 hover:text-red-700 px-2"
                            title="Limpiar todos los puntos"
                        >
                            <Trash2 className="h-3 w-3 mr-1" /> Limpiar
                        </Button>
                    </div>
                </div>

                {/* Form: name + color */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="zone-name" className="text-sm font-medium">
                            Nombre de la zona <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="zone-name"
                            placeholder="Ej: Zona Centro"
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            className="h-8 text-sm"
                            maxLength={60}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Color del polígono</Label>
                        <div className="flex gap-2 flex-wrap pt-0.5">
                            {ZONE_COLORS.map((c) => (
                                <button
                                    key={c.value}
                                    type="button"
                                    title={c.label}
                                    onClick={() => setColor(c.value)}
                                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                                        color === c.value
                                            ? 'border-gray-800 scale-110 shadow-md'
                                            : 'border-transparent hover:scale-105 hover:border-gray-300'
                                    }`}
                                    style={{ backgroundColor: c.value }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                    <Button
                        onClick={handleSave}
                        disabled={saving || !isValid}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-sm h-9"
                    >
                        {saving
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                            : <><Save className="h-4 w-4 mr-2" />{editingZone ? 'Actualizar Zona' : 'Guardar Zona'}</>
                        }
                    </Button>
                    <Button
                        variant="outline"
                        onClick={onCancel}
                        disabled={saving}
                        className="text-sm h-9"
                    >
                        <X className="h-4 w-4 mr-1" /> Cancelar
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

export default ZoneEditor;
