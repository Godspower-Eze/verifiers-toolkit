import type { AccountInterface } from 'starknet';
import type { StarknetWindowObject } from 'starknetkit';

/** Shared wallet state passed between hooks */
export interface WalletState {
  wallet: StarknetWindowObject | null;
  account: AccountInterface | null;
  address: string | null;
  chainId?: string | null;
}
