import { useEffect, useState } from 'react';

/**
 * Hook to get the current theme color and provide utility functions for button styling
 * Returns theme-aware colors that update dynamically when theme changes
 * @returns {Object} { themeColor, activeColor, inactiveColor, getButtonClass, getBgClass }
 */
export const useThemeButtonColors = () => {
  const [themeColor, setThemeColor] = useState('magenta');

  useEffect(() => {
    const currentTheme = document.body.getAttribute('data-theme') || 'magenta';
    setThemeColor(currentTheme);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          const newTheme = document.body.getAttribute('data-theme') || 'magenta';
          setThemeColor(newTheme);
        }
      });
    });

    observer.observe(document.body, { 
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  // Map theme names to their actual color values for inline usage if needed
  const themeColorMap = {
    orange: 'hsl(24, 95%, 53%)',
    blue: 'hsl(217, 91%, 60%)',
    green: 'hsl(142, 71%, 45%)',
    magenta: 'hsl(312, 84%, 51%)',
    red: 'hsl(0, 84%, 60%)',
    golden: 'hsl(45, 93%, 47%)'
  };

  const activeColor = themeColorMap[themeColor] || themeColorMap.magenta;
  const inactiveColor = 'hsl(0, 0%, 83%)'; // Light gray for disabled buttons

  /**
   * Get the appropriate button class based on enabled state
   * Uses the current theme's primary color from CSS variables
   * @param {boolean} enabled - Whether the button is enabled
   * @param {boolean} isActive - Whether the button is currently active/selected
   * @returns {string} CSS class string
   */
  const getButtonClass = (enabled, isActive = false) => {
    if (!enabled) {
      return "bg-gray-300 text-gray-500 cursor-not-allowed border-gray-200 hover:bg-gray-300";
    }
    
    if (isActive) {
      return "bg-primary text-white border-primary shadow-md hover:bg-primary/90 font-semibold";
    }
    
    return "bg-primary text-white border-primary shadow-sm hover:bg-primary/90 hover:shadow-md";
  };

  /**
   * Get background color class for elements that need theme-aware backgrounds
   * @param {boolean} enabled - Whether the element is enabled
   * @returns {string} CSS class string
   */
  const getBgClass = (enabled = true) => {
    if (!enabled) {
      return "bg-gray-300";
    }
    return "bg-primary";
  };

  return { 
    themeColor, 
    activeColor,
    inactiveColor,
    getButtonClass,
    getBgClass
  };
};