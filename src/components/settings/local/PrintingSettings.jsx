import React from 'react';
import { SettingsField, FontSelector } from './common';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollText, Type, Palette, Printer, ScrollText as FontSize, MoveHorizontal } from 'lucide-react';

const PrintingSettings = ({ settings, handleChange, handleSliderChange, handleFontChange }) => {
    const printFontOptions = [
        { value: 'sans-serif', label: 'Sans Serif' },
        { value: 'serif', label: 'Serif' },
        { value: 'monospace', label: 'Monospace (Ticket)' },
    ];

    return (
        <>
            <div className="pt-4 border-t">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Datos de Impresión</h3>
                <div className="grid md:grid-cols-2 gap-8">
                    <SettingsField id="ticketHeader" label="Encabezado de Ticket" value={settings.ticketHeader} onChange={handleChange} icon={ScrollText} />
                    <SettingsField id="ticketFooter" label="Pie de Ticket" value={settings.ticketFooter} onChange={handleChange} icon={ScrollText} />
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-2">
                    <Label htmlFor="fontSize" className="flex items-center text-gray-700 font-semibold"><Type className="mr-2 h-5 w-5 text-orange-500" /> Altura de Fuente de Aplicación</Label>
                    <div className="flex items-center space-x-4">
                        <Slider id="fontSize" min={12} max={20} step={1} value={[settings.fontSize]} onValueChange={(value) => handleSliderChange('fontSize', value)} />
                        <span className="font-bold w-12 text-center">{settings.fontSize}px</span>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="printTone" className="flex items-center text-gray-700 font-semibold"><Palette className="mr-2 h-5 w-5 text-orange-500" /> Tono de Impresión de Comandas</Label>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-500">Claro</span>
                        <Slider id="printTone" min={1} max={10} step={1} value={[settings.printTone]} onValueChange={(value) => handleSliderChange('printTone', value)} />
                        <span className="text-sm text-gray-500">Oscuro</span>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 pt-4 border-t">
                 <div className="space-y-2">
                    <Label htmlFor="printFontSize" className="flex items-center text-gray-700 font-semibold"><FontSize className="mr-2 h-5 w-5 text-orange-500" /> Tamaño de Fuente de Impresión</Label>
                    <div className="flex items-center space-x-4">
                        <Slider id="printFontSize" min={16} max={40} step={1} value={[settings.printFontSize]} onValueChange={(value) => handleSliderChange('printFontSize', value)} />
                        <span className="font-bold w-12 text-center">{settings.printFontSize}px</span>
                    </div>
                </div>
                <FontSelector id="fuenteImpresion" label="Fuente de Impresión" value={settings.fuenteImpresion} onChange={(v) => handleFontChange('fuenteImpresion', v)} icon={Printer} options={printFontOptions} />
            </div>

            <div className="grid md:grid-cols-2 gap-8 pt-4 border-t">
                <div className="space-y-2">
                    <Label htmlFor="printHorizontalOffset" className="flex items-center text-gray-700 font-semibold"><MoveHorizontal className="mr-2 h-5 w-5 text-orange-500" /> Ajuste Horizontal de Impresión</Label>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-500 w-12 text-right">← Izq</span>
                        <Slider
                            id="printHorizontalOffset"
                            min={-10}
                            max={10}
                            step={1}
                            value={[settings.printHorizontalOffset ?? 0]}
                            onValueChange={(value) => handleSliderChange('printHorizontalOffset', value)}
                        />
                        <span className="text-sm text-gray-500 w-12">Der →</span>
                        <span className="font-bold w-10 text-center">{(settings.printHorizontalOffset ?? 0) > 0 ? '+' : ''}{settings.printHorizontalOffset ?? 0}mm</span>
                    </div>
                    <p className="text-xs text-gray-400">Valor 0 = posición normal. Negativo mueve hacia la izquierda, positivo hacia la derecha.</p>
                </div>
            </div>
        </>
    );
};

export default PrintingSettings;