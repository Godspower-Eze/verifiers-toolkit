"use client";

import { useState, useCallback } from 'react';
import { connect, disconnect } from 'starknetkit';
import { Account, AccountInterface } from 'starknet';
import type { StarknetWindowObject } from 'starknetkit';

export function useStarknetWallet() {
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<StarknetWindowObject | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);


  // No auto-reconnect — wallet connection is user-initiated only

  const connectWallet = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const result = await connect({
        modalMode: 'alwaysAsk',
        modalTheme: 'dark',
      });
      if (result.wallet) {
        setWallet(result.wallet);
        if (result.connectorData && result.connectorData.account) {
          setAddress(result.connectorData.account);
          
          // StarknetKit v3 usually populates result.wallet.account natively via the extension.
          // This object already contains the provider context (e.g. from Argent X) bypassing default public rate limits.
          const w = result.wallet as any;
          if (w.account) {
            setAccount(w.account);
          }
        }
      }
    } catch (e) {
      console.error('Wallet connection failed:', e);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting]);

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect({ clearLastWallet: true });
      setAccount(null);
      setAddress(null);
      setWallet(null);
    } catch (e) {
      console.error('Wallet disconnect failed:', e);
    }
  }, []);

  return {
    account,
    address,
    wallet,
    isConnected: !!address, // Derived state based on address string
    isConnecting,
    connectWallet,
    disconnectWallet,
  };
}
