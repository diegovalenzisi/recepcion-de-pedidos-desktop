
import React from 'react';
import { Label } from '@/components/ui/label';
import { Palette, Check } from 'lucide-react';
import { saveSettings } from '@/lib/api/settingsApi';

const colorThemes = [
  { name: 'orange',  class: 'bg-orange-500' },
  { name: 'blue',    class: 'bg-blue-500' },
  { name: 'green',   class: 'bg-green-500' },
  { name: 'golden',  class: 'bg-amber-500' },
  { name: 'magenta', class: 'bg-fuchsia-600' },
  { name: 'red',     class: 'bg-red-600' },
];

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
      <div className="flex items-center space-x-3">
        {colorThemes.map(theme => (
          <button
            key={theme.name}
            onClick={() => handleThemeChange(theme.name)}
            className={`w-8 h-8 rounded-full ${theme.class} flex items-center justify-center ring-2 ring-offset-2 transition-all ${
              currentTheme === theme.name ? 'ring-gray-700 scale-110' : 'ring-transparent hover:scale-105'
            }`}
            aria-label={`Seleccionar tema ${theme.name}`}
          >
            {currentTheme === theme.name && <Check className="w-5 h-5 text-white" />}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSelector;
