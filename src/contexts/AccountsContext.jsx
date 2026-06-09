import React, { createContext, useState, useContext, useMemo } from 'react';

const AccountsContext = createContext(null);

export const AccountsProvider = ({ children }) => {
  const [accountsLocalId, setAccountsLocalId] = useState(null);
  
  const value = useMemo(() => ({ 
    accountsLocalId, 
    setAccountsLocalId 
  }), [accountsLocalId]);

  return (
    <AccountsContext.Provider value={value}>
      {children}
    </AccountsContext.Provider>
  );
};

export const useAccounts = () => {
  const context = useContext(AccountsContext);
  if (!context) {
    throw new Error("useAccounts must be used within an AccountsProvider");
  }
  return context;
};