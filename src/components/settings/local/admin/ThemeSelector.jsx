
import React from 'react';
import { Label } from '@/components/ui/label';
import { Palette, Check } from 'lucide-react';
import { saveSettings } from '@/lib/api/settingsApi';
import { TEMAS, colorDeTema } from '@/lib/api/temaColores';

// La lista sale de la paleta unica (src/lib/api/temaColores.js): antes estaba
// duplicada aca, y agregar un color obligaba a tocar tres archivos a mano.
// El color va INLINE, no como clase de Tailwind. Tailwind solo emite las
// clases que encuentra escritas en el codigo fuente, y las de los pasteles se
// arman en runtime (`bg-[hsl(${h},${s}%,${l}%)]`): nunca llegaban al CSS y esas
// 22 muestras quedaban sin fondo. Con el color inline la muestra es siempre
// exactamente el HSL del tema, sin depender de lo que Tailwind alcance a ver.
const colorThemes = TEMAS.map((t) => ({
  name: t.nombre, label: t.etiqueta, pastel: t.pastel, color: colorDeTema(t.nombre),
}));

const ThemeSelector = ({ settings, onSettingsChange, applySettings }) => {
  const handleThemeChange = async (themeName) => {
    // 1. Aplicar visualmente de inmediato
    if (applySettings) applySettings({ ...settings, themeColor: themeName });

    // 2. Actualizar estado local (para que el check mark se mueva)
    if (onSettingsChange) onSettingsChange(prev => ({ ...prev, themeColor: themeName }));

    // 3. Guardar en Firebase sin esperar al botón "Guardar"
    try {
      await saveSettings({ themeColor: themeName });
    } catch (e) {
      console.error('[theme] Error al guardar tema:', e);
    }
  };

  const currentTheme = settings?.themeColor;

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-3">
        <Palette className="mr-2 h-4 w-4" /> Tema de la Aplicación
      </Label>
      {/*
        `flex-wrap` + `gap` en vez de `flex` + `space-x`.

        Con 44 muestras, un flex de una sola fila las achicaba: los ítems de un
        flex tienen `flex-shrink: 1` por defecto, así que el `w-8` cedía hasta
        casi cero mientras el `h-8` se mantenía, y los círculos quedaban como
        rayitas verticales. `shrink-0` en cada botón impide ese achicamiento y
        `flex-wrap` los reparte en las filas que hagan falta según el ancho.

        `gap-3` en lugar de `space-x-3` porque `space-x` solo separa en
        horizontal: al haber varias filas, quedaban pegadas verticalmente.
      */}
      <div className="flex flex-wrap items-center gap-3">
        {colorThemes.map(theme => (
          <button
            key={theme.name}
            onClick={() => handleThemeChange(theme.name)}
            title={theme.label}
            style={{ backgroundColor: theme.color }}
            className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ring-2 ring-offset-2 transition-all ${
              currentTheme === theme.name ? 'ring-gray-700 scale-110' : 'ring-transparent hover:scale-105'
            }`}
            aria-label={`Seleccionar tema ${theme.label}`}
          >
            {/* Sobre un pastel el tilde blanco no se vería: va oscuro. */}
            {currentTheme === theme.name && (
              <Check className={`w-5 h-5 ${theme.pastel ? 'text-gray-800' : 'text-white'}`} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSelector;
