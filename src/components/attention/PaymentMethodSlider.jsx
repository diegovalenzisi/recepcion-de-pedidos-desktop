import React from 'react';
import { Button } from '@/components/ui/button';
import { Wallet, Landmark, Banknote, CreditCard } from 'lucide-react';
import { cn } from "@/lib/utils";

const PaymentMethodSlider = ({ methods, onSelect, selectedMethod }) => {
    // Pure UI component. Should NOT have side effects.
    // Relies completely on props.

    if (!methods || methods.length === 0) {
      return (
        <div className="text-center text-sm text-gray-500 py-4">
          No hay métodos de pago disponibles.
        </div>
      );
    }
    
    const methodIcons = {
        'Efectivo': <Banknote className="h-6 w-6" />,
        'Transferencia': <Landmark className="h-6 w-6" />,
        'Transferencia 2': <Landmark className="h-6 w-6 text-blue-500" />,
        'Tarjeta': <CreditCard className="h-6 w-6" />,
        'default': <Wallet className="h-6 w-6" />
    };
    
    const getIcon = (methodName) => {
        // More robust matching for icons
        const lowerName = methodName.toLowerCase();
        if (lowerName.includes('efectivo')) return methodIcons['Efectivo'];
        if (lowerName.includes('transferencia')) return methodIcons['Transferencia']; // Covers 'Transferencia 2' vaguely if not matched exact
        if (lowerName.includes('tarjeta') || lowerName.includes('débito') || lowerName.includes('crédito')) return methodIcons['Tarjeta'];
        return methodIcons.default;
    }

    const isSelected = (method) => {
        if (!selectedMethod) return false;
        return selectedMethod === method || selectedMethod.toLowerCase() === method.toLowerCase();
    };

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {methods.map((method) => (
                <Button
                    key={method}
                    variant="outline"
                    type="button" // Explicitly type button to prevent form submissions if inside form
                    className={cn(
                        "w-full h-20 flex flex-col gap-2 transition-all relative",
                        isSelected(method) 
                            ? "bg-primary text-white border-primary-dark hover:bg-primary/90 hover:text-white shadow-md transform scale-[1.02]" 
                            : "hover:bg-gray-100 hover:border-gray-300"
                    )}
                    onClick={(e) => {
                        e.preventDefault(); // Prevent bubbling issues
                        onSelect(method);
                    }}
                >
                    {getIcon(method)}
                    <span className="text-xs font-semibold text-center break-words leading-tight">{method}</span>
                    {isSelected(method) && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-white rounded-full animate-pulse" />
                    )}
                </Button>
            ))}
        </div>
    );
}

export default PaymentMethodSlider;