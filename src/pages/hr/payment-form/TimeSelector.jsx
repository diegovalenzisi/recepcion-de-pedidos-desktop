import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const TimeSelector = ({ value, onChange, label }) => {
  const [hour, minute] = value ? value.split(':') : ['', ''];

  const handleTimeChange = (part, val) => {
    let numericValue = parseInt(val, 10);
    if (isNaN(numericValue)) numericValue = 0;

    if (part === 'hour') {
      if (numericValue < 0) numericValue = 24;
      if (numericValue > 24) numericValue = 0;
      onChange(`${numericValue.toString().padStart(2, '0')}:${minute || '00'}`);
    } else { // minute
      if (numericValue < 0) numericValue = 45;
      if (numericValue >= 60) numericValue = 0;
      
      const validMinutes = [0, 15, 30, 45];
      let closest = validMinutes.reduce((prev, curr) => 
        (Math.abs(curr - numericValue) < Math.abs(prev - numericValue) ? curr : prev)
      );
      
      onChange(`${hour || '00'}:${closest.toString().padStart(2, '0')}`);
    }
  };

  const handleBlur = (part, val) => {
    if (part === 'hour') {
      handleTimeChange(part, val);
    } else {
      handleTimeChange(part, val);
    }
  };
  
  const handleWheel = (e, part) => {
    e.preventDefault();
    const currentValue = parseInt(part === 'hour' ? hour : minute, 10) || 0;
    const step = part === 'hour' ? 1 : 15;
    const newValue = e.deltaY < 0 ? currentValue + step : currentValue - step;
    handleTimeChange(part, newValue.toString());
  };

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input 
          type="number"
          value={hour}
          onChange={(e) => handleTimeChange('hour', e.target.value)}
          onBlur={(e) => handleBlur('hour', e.target.value)}
          onWheel={(e) => handleWheel(e, 'hour')}
          min="0"
          max="24"
          placeholder="HH"
          className="h-9 text-center"
        />
        <Input 
          type="number"
          value={minute}
          onChange={(e) => handleTimeChange('minute', e.target.value)}
          onBlur={(e) => handleBlur('minute', e.target.value)}
          onWheel={(e) => handleWheel(e, 'minute')}
          step="15"
          min="0"
          max="45"
          placeholder="MM"
          className="h-9 text-center"
        />
      </div>
    </div>
  );
};

export default TimeSelector;