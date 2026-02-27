import { useState, useEffect, useCallback } from 'react';

const RECENT_CONTRACTS_KEY = 'caverig_recent_contracts';
const MAX_RECENT = 5;

export function useRecentDeployments() {
  const [recentAddresses, setRecentAddresses] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadContracts = useCallback(() => {
    try {
      const stored = localStorage.getItem(RECENT_CONTRACTS_KEY);
      if (stored) {
        setRecentAddresses(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed to load recent contracts from localStorage');
    }
  }, []);

  useEffect(() => {
    loadContracts();
    setIsLoaded(true);

    // Cross-tab sync
    const handleStorage = (e: StorageEvent) => {
      if (e.key === RECENT_CONTRACTS_KEY) loadContracts();
    };
    window.addEventListener('storage', handleStorage);

    // Same-tab sync
    const handleLocalUpdate = () => loadContracts();
    window.addEventListener('recentDeploymentsUpdated', handleLocalUpdate);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('recentDeploymentsUpdated', handleLocalUpdate);
    };
  }, [loadContracts]);

  const addAddress = useCallback((address: string) => {
    // We update state first
    setRecentAddresses(prev => {
      const filtered = prev.filter(a => a !== address);
      const updated = [address, ...filtered].slice(0, MAX_RECENT);
      
      // Schedule side effects outside the React update cycle
      setTimeout(() => {
        try {
          localStorage.setItem(RECENT_CONTRACTS_KEY, JSON.stringify(updated));
          window.dispatchEvent(new Event('recentDeploymentsUpdated'));
        } catch (e) {
          console.warn('Failed to save recent contracts to localStorage');
        }
      }, 0);

      return updated;
    });
  }, []);

  return { recentAddresses, addAddress, isLoaded };
}

export function usePersistedVk() {
  const [vkJson, setVkJson] = useState<string>('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('caverig_last_vk');
      if (stored) setVkJson(stored);
    } catch (e) {
      // ignore
    }
  }, []);

  const saveVk = useCallback((jsonStr: string) => {
    setVkJson(jsonStr);
    try {
      localStorage.setItem('caverig_last_vk', jsonStr);
    } catch (e) {
      // ignore
    }
  }, []);

  return { vkJson, saveVk };
}
