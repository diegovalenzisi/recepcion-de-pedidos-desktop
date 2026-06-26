import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Music, Upload, Trash2, Play, Volume2 } from 'lucide-react';
import { getVoicePaymentVolume, setVoicePaymentVolume } from '@/hooks/useVoicePaymentAlerts';

const AudioSettings = ({ onAudioChange, initialAudioName, initialAudioDataUrl, orderSoundVolume, onOrderSoundVolumeChange }) => {
    const [fileName, setFileName] = useState(initialAudioName || 'Ningún archivo seleccionado');
    const [audio, setAudio] = useState(null);
    const [voicePaymentVolume, setVoicePaymentVolumeState] = useState(getVoicePaymentVolume);
    const fileInputRef = useRef(null);
    const { toast } = useToast();

    const handleVoicePaymentVolumeChange = (value) => {
        const newVolume = value[0];
        setVoicePaymentVolumeState(newVolume);
        setVoicePaymentVolume(newVolume);
    };

    useEffect(() => {
        setFileName(initialAudioName || 'Ningún archivo seleccionado');
        if (initialAudioDataUrl) {
            setAudio(new Audio(initialAudioDataUrl));
        } else {
            setAudio(null);
        }
    }, [initialAudioName, initialAudioDataUrl]);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                toast({ variant: "destructive", title: "Archivo demasiado grande", description: "El archivo de audio no debe superar los 5MB." });
                return;
            }
            if (!['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(file.type)) {
                toast({ variant: "destructive", title: "Formato no válido", description: "Por favor, selecciona un archivo MP3, WAV o OGG." });
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                onAudioChange({
                    dataUrl: dataUrl,
                    name: file.name
                });
                setFileName(file.name);
                setAudio(new Audio(dataUrl));
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleRemoveAudio = () => {
        onAudioChange(null);
        setFileName('Ningún archivo seleccionado');
        setAudio(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handlePlayTestSound = () => {
        if (audio) {
            audio.play().catch(e => toast({ variant: "destructive", title: "Error de reproducción", description: "No se pudo reproducir el audio."}));
        }
    };

    return (
        <div className="pt-4 border-t">
            <div className="space-y-2">
                <Label className="flex items-center text-gray-700 font-semibold">
                    <Music className="mr-2 h-5 w-5 text-orange-500" />
                    Sonido de Alerta de Pedido
                </Label>
                <div className="flex items-center space-x-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="audio/mpeg,audio/wav,audio/ogg"
                        className="hidden"
                    />
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current.click()}>
                        <Upload className="mr-2 h-4 w-4" /> Examinar...
                    </Button>
                     <Button type="button" variant="outline" size="icon" onClick={handlePlayTestSound} disabled={!audio}>
                        <Play className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-600 truncate flex-grow" title={fileName}>{fileName}</span>
                     {(initialAudioName || audio) && (
                        <Button type="button" variant="ghost" size="icon" onClick={handleRemoveAudio}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                    )}
                </div>
                 <p className="text-xs text-gray-500 ml-1">Selecciona un archivo de audio (.mp3, .wav, .ogg) para las notificaciones de nuevos pedidos.</p>
            </div>

            <div className="space-y-2 pt-4">
                <Label className="flex items-center text-gray-700 font-semibold">
                    <Volume2 className="mr-2 h-5 w-5 text-orange-500" />
                    Volumen sonido de pedidos
                </Label>
                <div className="flex items-center space-x-4">
                    <Slider min={0} max={100} step={1} value={[orderSoundVolume ?? 100]} onValueChange={onOrderSoundVolumeChange} />
                    <span className="font-bold w-12 text-center">{orderSoundVolume ?? 100}%</span>
                </div>
            </div>

            <div className="space-y-2 pt-4">
                <Label className="flex items-center text-gray-700 font-semibold">
                    <Volume2 className="mr-2 h-5 w-5 text-orange-500" />
                    Volumen pagos por voz
                </Label>
                <div className="flex items-center space-x-4">
                    <Slider min={0} max={100} step={1} value={[voicePaymentVolume]} onValueChange={handleVoicePaymentVolumeChange} />
                    <span className="font-bold w-12 text-center">{voicePaymentVolume}%</span>
                </div>
            </div>
        </div>
    );
};

export default AudioSettings;