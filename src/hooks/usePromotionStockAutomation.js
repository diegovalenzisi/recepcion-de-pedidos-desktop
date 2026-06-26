import { useState, useEffect, useCallback } from 'react';
import { checkAndUpdatePromotionStockStatus, listenToPromotionStockChanges } from '@/lib/api/promotionStockAutomation';

export const usePromotionStockAutomation = (isActive = true) => {
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState(null);
    const [summary, setSummary] = useState(null);

    const checkPromotions = useCallback(async () => {
        if (!isActive) return;
        
        setIsChecking(true);
        setError(null);
        try {
            const result = await checkAndUpdatePromotionStockStatus();
            setSummary(result);
            return result;
        } catch (err) {
            setError(err.message);
            console.error("Failed to check promotion stock status", err);
        } finally {
            setIsChecking(false);
        }
    }, [isActive]);

    useEffect(() => {
        if (isActive) {
            // Initial check
            checkPromotions();
            
            // Set up real-time listener for ongoing changes
            const unsubscribe = listenToPromotionStockChanges((newSummary) => {
                setSummary(newSummary);
            });

            return () => {
                if (unsubscribe) unsubscribe();
            };
        }
    }, [isActive, checkPromotions]);

    return {
        isChecking,
        error,
        summary,
        checkPromotions
    };
};