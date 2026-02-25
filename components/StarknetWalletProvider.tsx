"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { connect, disconnect } from 'starknetkit';
import { AccountInterface } from 'starknet';
import type { StarknetWindowObject } from 'starknetkit';
import { SEPOLIA_CHAIN_ID } from '@/lib/starknet/constants';

interface StarknetWalletContextValue {
  account: AccountInterface | null;
  address: string | null;
  wallet: StarknetWindowObject | null;
  chainId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isSepolia: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

const StarknetWalletContext = createContext<StarknetWalletContextValue | null>(null);

export function useStarknetWalletContext() {
  const ctx = useContext(StarknetWalletContext);
  if (!ctx) {
    throw new Error('useStarknetWalletContext must be used within a StarknetWalletProvider');
  }
  return ctx;
}

export function StarknetWalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<StarknetWindowObject | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  // Auto-reconnect if previously connected (Silent connect)
  useEffect(() => {
    const trySilentConnect = async () => {
      try {
        const result = await connect({ modalMode: 'neverAsk' });
        if (result && result.wallet && result.connectorData?.account) {
           setWallet(result.wallet);
           setAddress(result.connectorData.account);
           setChainId(
             result.connectorData.chainId
               ? '0x' + result.connectorData.chainId.toString(16)
               : null
           );
           const w = result.wallet as any;
           if (w.account) setAccount(w.account);
        }
      } catch (e) {
        // Safe to ignore on silent connect
      }
    };
    trySilentConnect();
  }, []);

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
          setChainId(
            result.connectorData.chainId
              ? '0x' + result.connectorData.chainId.toString(16)
              : null
          );
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
      setChainId(null);
    } catch (e) {
      console.error('Wallet disconnect failed:', e);
    }
  }, []);

  const switchToSepolia = useCallback(async () => {
    if (!wallet) return;
    try {
      await wallet.request({
        type: 'wallet_switchStarknetChain' as any,
        params: { chainId: SEPOLIA_CHAIN_ID },
      });
      setChainId(SEPOLIA_CHAIN_ID);
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  }, [wallet]);

  // Listen for wallet network and account changes
  useEffect(() => {
    if (!wallet) return;

    const handleNetworkChanged = (newChainId?: string) => {
      if (newChainId) {
        const formatted = newChainId.startsWith('0x') ? newChainId : '0x' + newChainId;
        setChainId(formatted);
      }
    };

    const handleAccountsChanged = (accounts?: string[]) => {
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0]);
      } else {
        setAddress(null);
        setChainId(null);
        setWallet(null);
        setAccount(null);
      }
    };

    wallet.on('networkChanged' as any, handleNetworkChanged as any);
    wallet.on('accountsChanged' as any, handleAccountsChanged as any);

    return () => {
      wallet.off('networkChanged' as any, handleNetworkChanged as any);
      wallet.off('accountsChanged' as any, handleAccountsChanged as any);
    };
  }, [wallet]);

  return (
    <StarknetWalletContext.Provider
      value={{
        account,
        address,
        wallet,
        chainId,
        isConnected: !!address,
        isConnecting,
        isSepolia,
        connectWallet,
        disconnectWallet,
        switchToSepolia,
      }}
    >
      {children}
    </StarknetWalletContext.Provider>
  );
}
