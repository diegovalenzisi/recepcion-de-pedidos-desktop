import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const SettingsField = ({ id, label, value, onChange, icon: Icon, type = "text", onClick, readOnly }) => (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center text-gray-700 font-semibold">
        <Icon className="mr-2 h-5 w-5 text-orange-500" />
        {label}
      </Label>
      <Input
        id={id}
        value={value || ''}
        onChange={onChange}
        className="bg-gray-50"
        type={type}
        onClick={onClick}
        readOnly={readOnly || !!onClick}
      />
    </div>
);

export const FontSelector = ({ id, label, value, onChange, icon: Icon, options }) => (
    <div className="space-y-2">
        <Label htmlFor={id} className="flex items-center text-gray-700 font-semibold">
            <Icon className="mr-2 h-5 w-5 text-orange-500" />
            {label}
        </Label>
        <Select onValueChange={onChange} value={value}>
            <SelectTrigger id={id} className="bg-gray-50">
                <SelectValue placeholder="Seleccionar fuente..." />
            </SelectTrigger>
            <SelectContent>
                {options.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    </div>
);