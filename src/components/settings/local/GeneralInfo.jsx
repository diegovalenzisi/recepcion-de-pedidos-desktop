import React from 'react';
import { SettingsField, FontSelector } from './common';
import { Building, List, MapPin, Mail, Type, Phone } from 'lucide-react';

const GeneralInfo = ({ settings, handleChange, handleFontChange }) => {
    const appFontOptions = [
        { value: 'sans', label: 'Sans Serif (Default)' },
        { value: 'serif', label: 'Serif' },
        { value: 'mono', label: 'Monospace' },
    ];
    
    return (
        <div className="grid md:grid-cols-2 gap-8">
            <SettingsField id="razonSocial" label="Razón Social" value={settings.razonSocial} onChange={handleChange} icon={Building} />
            <SettingsField id="nombreFantasia" label="Nombre de Fantasía" value={settings.nombreFantasia} onChange={handleChange} icon={Building} />
            <SettingsField id="cuit" label="CUIT" value={settings.cuit} onChange={handleChange} icon={List} />
            <SettingsField id="telefono" label="Teléfono" value={settings.telefono} onChange={handleChange} icon={Phone} />
            <SettingsField id="direccion" label="Dirección" value={settings.direccion} onChange={handleChange} icon={MapPin} />
            <SettingsField id="localidad" label="Localidad" value={settings.localidad} onChange={handleChange} icon={MapPin} />
            <SettingsField id="mail" label="Mail" value={settings.mail} onChange={handleChange} icon={Mail} />
            <FontSelector id="fuente" label="Fuente de la Aplicación" value={settings.fuente} onChange={(v) => handleFontChange('fuente', v)} icon={Type} options={appFontOptions} />
        </div>
    );
};

export default GeneralInfo;