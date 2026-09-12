import React from 'react';
import { SettingsField, FontSelector } from './common';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollText, Type, Palette, Printer, ScrollText as FontSize, MoveHorizontal, Ruler } from 'lucide-react';
import { ANCHOS_SOPORTADOS, normalizarAncho } from '@/lib/print/paper';

const PrintingSettings = ({ settings, handleChange, handleSliderChange, handleFontChange, handleDirectChange }) => {
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

                {/*
                    AJUSTE INDEPENDIENTE PARA EL TICKET FISCAL (factura térmica).
                    El corrector de arriba (`printHorizontalOffset`) solo afecta a las
                    comandas y al ticket de mostrador (command.js / counterTicket.js):
                    el comprobante fiscal (comprobanteFiscalPrint.jsx) usa su propia
                    hoja de estilos y nunca leía ese valor, así que un desvío de la
                    impresora en la factura no se podía corregir sin mover también la
                    comanda. Mismo rango/paso que el de arriba, guardado y aplicado
                    igual, pero en una clave separada.
                */}
                <div className="space-y-2">
                    <Label htmlFor="printFiscalHorizontalOffset" className="flex items-center text-gray-700 font-semibold"><MoveHorizontal className="mr-2 h-5 w-5 text-orange-500" /> Ajuste Horizontal de Ticket Fiscal</Label>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-500 w-12 text-right">← Izq</span>
                        <Slider
                            id="printFiscalHorizontalOffset"
                            min={-10}
                            max={10}
                            step={1}
                            value={[settings.printFiscalHorizontalOffset ?? 0]}
                            onValueChange={(value) => handleSliderChange('printFiscalHorizontalOffset', value)}
                        />
                        <span className="text-sm text-gray-500 w-12">Der →</span>
                        <span className="font-bold w-10 text-center">{(settings.printFiscalHorizontalOffset ?? 0) > 0 ? '+' : ''}{settings.printFiscalHorizontalOffset ?? 0}mm</span>
                    </div>
                    <p className="text-xs text-gray-400">Solo afecta al ticket fiscal/factura térmica. Valor 0 = posición normal.</p>
                </div>

                {/*
                    ESCALA del ticket fiscal: independiente del offset horizontal de
                    arriba. Si a 100% el comprobante no entra completo en el ancho real
                    imprimible de la térmica, achicarlo (ej. 90/85/80%) reduce TODO el
                    comprobante proporcionalmente — vía scaleFactor de webContents.print
                    (comprobanteFiscalPrint.jsx), no tocando ningún ancho del CSS. Solo
                    afecta la impresión física del ticket fiscal.
                */}
                <div className="space-y-2">
                    <Label htmlFor="printFiscalScale" className="flex items-center text-gray-700 font-semibold"><Ruler className="mr-2 h-5 w-5 text-orange-500" /> Tamaño de Ticket Fiscal</Label>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-500 w-12 text-right">50%</span>
                        <Slider
                            id="printFiscalScale"
                            min={50}
                            max={100}
                            step={1}
                            value={[settings.printFiscalScale ?? 100]}
                            onValueChange={(value) => handleSliderChange('printFiscalScale', value)}
                        />
                        <span className="text-sm text-gray-500 w-12">100%</span>
                        <span className="font-bold w-12 text-center">{settings.printFiscalScale ?? 100}%</span>
                    </div>
                    <p className="text-xs text-gray-400">Solo afecta al ticket fiscal/factura térmica. 100% = tamaño actual, sin cambios.</p>
                </div>

                {/*
                    ANCHO DEL ROLLO. Va junto al ajuste horizontal porque son los
                    dos parámetros físicos del papel. Se guarda en CONFIGURACION
                    como el resto de los ajustes de impresión, con el mismo botón
                    "Guardar" de la pantalla.

                    80 mm es el valor por defecto y el comportamiento actual: un
                    local que no toque esto imprime exactamente como hasta ahora.
                */}
                <div className="space-y-2">
                    <Label htmlFor="printPaperWidth" className="flex items-center text-gray-700 font-semibold">
                        <Ruler className="mr-2 h-5 w-5 text-orange-500" /> Ancho del Papel
                    </Label>
                    <div className="flex items-center space-x-2">
                        {ANCHOS_SOPORTADOS.map((ancho) => {
                            const activo = normalizarAncho(settings.printPaperWidth) === ancho;
                            return (
                                <button
                                    key={ancho}
                                    type="button"
                                    id={ancho === 80 ? 'printPaperWidth' : undefined}
                                    onClick={() => handleDirectChange?.('printPaperWidth', ancho)}
                                    className={`px-6 py-2 rounded-md border font-bold transition-colors ${
                                        activo
                                            ? 'bg-orange-500 text-white border-orange-500'
                                            : 'bg-white text-gray-700 border-gray-300 hover:border-orange-400'
                                    }`}
                                >
                                    {ancho} mm
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-xs text-gray-400">
                        Ancho del rollo de la impresora térmica. 80 mm es el valor habitual; elegí 58 mm solo si
                        la impresora usa rollo angosto.
                    </p>
                </div>
            </div>
        </>
    );
};

export default PrintingSettings;