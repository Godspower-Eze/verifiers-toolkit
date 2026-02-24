"use client";

import { useState, useEffect, useCallback } from 'react';
import { connect, disconnect } from 'starknetkit';
import { AccountInterface } from 'starknet';

export function useStarknetWallet() {
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    const tryReconnect = async () => {
      try {
        const { wallet } = await connect({ modalMode: 'neverAsk' });
        const w = wallet as any;
        const addr = w?.selectedAddress || w?.account?.address;
        if (w && (w.isConnected || addr)) {
          setAccount(w.account || null);
          setAddress(addr || null);
          setIsConnected(true);
        }
      } catch (err) {
        // Ignore silent reconnect errors
      }
    };
    tryReconnect();
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      const { wallet } = await connect({
        modalMode: 'alwaysAsk',
        modalTheme: 'dark',
      });
      const w = wallet as any;
      console.log("StarknetKit connect result:", w);
      const addr = w?.selectedAddress || w?.account?.address;
      if (w && (w.isConnected || addr)) {
        setAccount(w.account || null);
        setAddress(addr || null);
        setIsConnected(true);
      }
    } catch (e) {
      console.error('Wallet connection failed:', e);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect({ clearLastWallet: true });
      setAccount(null);
      setAddress(null);
      setIsConnected(false);
    } catch (e) {
      console.error('Wallet disconnect failed:', e);
    }
  }, []);

  return {
    account,
    address,
    isConnected,
    connectWallet,
    disconnectWallet,
  };
}
