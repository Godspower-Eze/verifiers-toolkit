import { useState, useCallback, useEffect, useMemo } from 'react';
import { hash, Contract, RpcProvider } from 'starknet';
import { LogEntry, LogType } from '@/components/DeploymentLogs';
import type { GeneratedVerifier, ProofSystem } from '@/lib/verifier/types';
import { UDC_ADDRESS, getRpcUrl } from '@/lib/starknet/constants';
import type { WalletState } from '@/lib/starknet/types';
import { useRecentDeployments } from './useRecentDeployments';

export function useStarknetDeploy(projectId: string, { wallet, account, address, chainId }: WalletState) {

  // Dedicated RPC provider for reliable on-chain reads (class hash checks)
  const rpcProvider = useMemo(() => {
    return new RpcProvider({ nodeUrl: getRpcUrl(chainId) });
  }, [chainId]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isDeclaring, setIsDeclaring] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployClassHash, setDeployClassHash] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [deploySystem, setDeploySystem] = useState<ProofSystem>('groth16');
  
  const { addAddress } = useRecentDeployments();
  const [isAlreadyDeclared, setIsAlreadyDeclared] = useState(false);
  const [isCheckingDeclaration, setIsCheckingDeclaration] = useState(false);

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), timestamp: new Date(), message: msg, type }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // 1. Load from LocalStorage when projectId changes
  useEffect(() => {
    if (!projectId) return;
    const storedState = localStorage.getItem(`deployState_${projectId}`);
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        setDeployClassHash(parsed.classHash || null);
        setContractAddress(parsed.contractAddress || null);
      } catch (e) {
        console.error('Failed to parse deploy state', e);
      }
    } else {
      setDeployClassHash(null);
      setContractAddress(null);
      setIsAlreadyDeclared(false);
    }
  }, [projectId]);

  // Save to LocalStorage whenever classHash or contractAddress changes
  useEffect(() => {
    if (!projectId) return;
    if (deployClassHash || contractAddress) {
      localStorage.setItem(`deployState_${projectId}`, JSON.stringify({
        classHash: deployClassHash,
        contractAddress
      }));
    }
  }, [projectId, deployClassHash, contractAddress]);

  // 2. Pre-Check Class Hash using dedicated RPC provider
  useEffect(() => {
    const checkOnChain = async () => {
      if (!deployClassHash) return;
      setIsCheckingDeclaration(true);
      try {
        const classInfo = await rpcProvider.getClassByHash(deployClassHash) as any;
        // If the RPC fails silently or returns an empty object, it's not declared
        if (classInfo && (classInfo.sierra_program || classInfo.program)) {
          setIsAlreadyDeclared(true);
        } else {
          setIsAlreadyDeclared(false);
        }
      } catch (e: any) {
        console.warn('Class not declared or RPC failed:', e.message);
        setIsAlreadyDeclared(false);
      } finally {
        setIsCheckingDeclaration(false);
      }
    };
    checkOnChain();
  }, [rpcProvider, deployClassHash]);


  const handleCompileAndDeclare = useCallback(async (verifier: GeneratedVerifier) => {
    if (!wallet || !account || !address || !verifier) return;
    setIsDeclaring(true);
    setDeploySystem(verifier.system);
    addLog('Starting API compilation (Cairo → Sierra/Casm)...', 'info');

    try {
      const compileEndpoint = verifier.system === 'ultra_keccak_zk_honk'
        ? '/api/circuit/noir/verifier/compile'
        : '/api/verifier/compile';
      const compileRes = await fetch(compileEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifier),
      });
      const compileData = await compileRes.json();
      
      if (!compileData.success) {
        throw new Error(compileData.error || 'Compilation failed');
      }
      
      // Calculate compiled class hash
      const compiledClassHash = hash.computeCompiledClassHash(compileData.casm);
      
      // Calculate Cairo 1 class hash
      const cairo1ClassHash = hash.computeContractClassHash(compileData.sierra);

      addLog(`Compiled successfully. Class Hash: ${cairo1ClassHash}`, 'success');

      try {
        await rpcProvider.getClassByHash(cairo1ClassHash);
        addLog('Class is already declared on-chain. Skipping declaration.', 'success');
        setDeployClassHash(cairo1ClassHash);
        setIsAlreadyDeclared(true);
        addLog('Please click Deploy to create the contract instance.', 'info');
        return cairo1ClassHash;
      } catch (e) {
        // Not declared, proceed.
      }

      addLog('Requesting wallet signature to Declare...', 'info');

      // Declare using wallet request directly to avoid intermediate fee estimations on default RPCs
      const declareResponse: any = await wallet.request({
        type: 'wallet_addDeclareTransaction' as any,
        params: {
          compiled_class_hash: compiledClassHash,
          contract_class: compileData.sierra
        }
      });
      
      const txHash = declareResponse.transaction_hash;
      const classHash = declareResponse.class_hash;

      addLog(`Declare TX sent: ${txHash}. Waiting for L2 acceptance...`, 'info');
      await rpcProvider.waitForTransaction(txHash);
      
      addLog(`Contract declared successfully! Class Hash: ${classHash}`, 'success');
      setDeployClassHash(classHash);
      setIsAlreadyDeclared(true);
      addLog('Declaration successful. Please click Deploy.', 'info');
      
      return classHash;
    } catch (err: any) {
      addLog(`Declare failed: ${err.message || String(err)}`, 'error');
      return null;
    } finally {
      setIsDeclaring(false);
    }
  }, [wallet, address, account, rpcProvider, addLog]);

  const handleDeploy = useCallback(async () => {
    if (!wallet || !account || !deployClassHash) return;
    setIsDeploying(true);
    try {
      addLog('Requesting wallet signature to Deploy...', 'info');
      
      // Generate a random 32-bit salt
      const salt = "0x" + Math.floor(Math.random() * 1000000000).toString(16);
      
      const deployResponse: any = await wallet.request({
        type: 'wallet_addInvokeTransaction' as any,
        params: {
          calls: [{
            contract_address: UDC_ADDRESS,
            entry_point: "deployContract",
            calldata: [deployClassHash, salt, "0", "0"]
          }]
        }
      });
      
      const txHash = deployResponse.transaction_hash;
      
      addLog(`Deploy TX sent: ${txHash}. Waiting for L2 acceptance...`, 'info');
      await rpcProvider.waitForTransaction(txHash);
      
      // The UDC precomputes the deployed contract's address natively deterministically
      const calculatedAddress = hash.calculateContractAddressFromHash(
        salt,
        deployClassHash,
        [],
        0
      );
      
      setContractAddress(calculatedAddress);
      addAddress(calculatedAddress, deploySystem);
      
      addLog(`Deployment successful! Contract Address: ${calculatedAddress}`, 'success');
      addLog('Switch to the Verify section in the sidebar to verify a proof against this contract.', 'info');
      
      return calculatedAddress;
    } catch (err: any) {
      addLog(`Deploy failed: ${err.message || String(err)}`, 'error');
      return null;
    } finally {
      setIsDeploying(false);
    }
  }, [wallet, account, deployClassHash, deploySystem, rpcProvider, addLog]);

  const resetDeployState = useCallback(() => {
    setDeployClassHash(null);
    setContractAddress(null);
    setIsAlreadyDeclared(false);
    clearLogs();
    if (projectId) {
      localStorage.removeItem(`deployState_${projectId}`);
    }
  }, [projectId, clearLogs]);

  return {
    logs,
    clearLogs,
    addLog,
    isDeclaring,
    isDeploying,
    deployClassHash,
    contractAddress,
    isAlreadyDeclared,
    isCheckingDeclaration,
    handleCompileAndDeclare,
    handleDeploy,
    resetDeployState
  };
}
