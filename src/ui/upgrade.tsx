import { createContext, useContext } from "react";

/**
 * Where "Unlock with Pro" goes. The overlay provides one that opens its plan
 * screen. Anything rendered outside it falls back to a no-op so a stray lock
 * can never crash a screen.
 */
export type UpgradeAction = (placement: string) => void;

export const UpgradeContext = createContext<UpgradeAction>(() => undefined);

export function useUpgrade(): UpgradeAction {
  return useContext(UpgradeContext);
}
