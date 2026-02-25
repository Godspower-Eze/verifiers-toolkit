/** Starknet Sepolia chain ID in hex */
export const SEPOLIA_CHAIN_ID = '0x534e5f5345504f4c4941';

/** Universal Deployer Contract address */
export const UDC_ADDRESS = '0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf';

/** RPC endpoint URLs — read from env, with fallback to public endpoints */
export const RPC_URLS = {
  sepolia: process.env.NEXT_PUBLIC_STARKNET_RPC_SEPOLIA || 'https://free-rpc.nethermind.io/sepolia-juno/v0_7',
  mainnet: process.env.NEXT_PUBLIC_STARKNET_RPC_MAINNET || 'https://free-rpc.nethermind.io/mainnet-juno/v0_7',
} as const;

/** Get the correct RPC URL based on chainId */
export function getRpcUrl(chainId?: string | null): string {
  return chainId === SEPOLIA_CHAIN_ID ? RPC_URLS.sepolia : RPC_URLS.mainnet;
}

/** Human-readable chain name from chainId */
export function getChainName(chainId?: string | null): string {
  if (!chainId) return 'Unknown';
  return chainId === SEPOLIA_CHAIN_ID ? 'Sepolia' : 'Mainnet';
}
