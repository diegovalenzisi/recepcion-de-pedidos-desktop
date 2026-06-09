// <legacy_file_override>
// This file previously contained manual stock deduction logic which caused conflicts.
// It is now overwritten to strictly export the centralized, safe functions from the new API.
// </legacy_file_override>

import { saveCounterSale, cancelCounterSale, fetchCounterSalesForShift } from '@/lib/api/counterApi';

export {
    saveCounterSale,
    cancelCounterSale,
    fetchCounterSalesForShift
};