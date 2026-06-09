
import React from 'react';
import { Label } from '@/components/ui/label';
import { Palette, Check } from 'lucide-react';

const colorThemes = [
  { name: 'orange', class: 'bg-orange-500' },
  { name: 'blue', class: 'bg-blue-500' },
  { name: 'green', class: 'bg-green-500' },
  { name: 'golden', class: 'bg-amber-500' },
  { name: 'magenta', class: 'bg-fuchsia-600' },
  { name: 'red', class: 'bg-red-600' },
];

const ThemeSelector = ({ settings, onSettingsChange, applySettings }) => {
  const handleThemeChange = (themeName) => {
    const newSettings = { ...settings, themeColor: themeName };
    if (onSettingsChange) onSettingsChange(newSettings);
    if (applySettings) applySettings(newSettings);
  };

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-2"><Palette className="mr-2 h-4 w-4" /> Tema de la Aplicación</Label>
      <div className="flex items-center space-x-2">
        {colorThemes.map(theme => (
          <button
            key={theme.name}
            onClick={() => handleThemeChange(theme.name)}
            className={`w-8 h-8 rounded-full ${theme.class} flex items-center justify-center ring-2 ring-offset-2 transition-all ${settings?.themeColor === theme.name ? 'ring-primary-dark' : 'ring-transparent'}`}
            aria-label={`Seleccionar tema ${theme.name}`}
          >
            {settings?.themeColor === theme.name && <Check className="w-5 h-5 text-white" />}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSelector;
