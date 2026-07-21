import { useState, useEffect, useCallback } from 'react';
import { checkAndUpdatePromotionStockStatus, listenToPromotionStockChanges } from '@/lib/api/promotionStockAutomation';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

export const usePromotionStockAutomation = (isActive = true) => {
    const { ready: firebaseReady } = useFirebaseReadiness();
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
        if (isActive && firebaseReady) {
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
    }, [isActive, firebaseReady, checkPromotions]);

    return {
        isChecking,
        error,
        summary,
        checkPromotions
    };
};