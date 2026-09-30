import { bundledFlags, evaluateFlag, type FlagKey, type RemoteConfig } from "../lib/remoteConfig";

let doc: RemoteConfig | null = null;

export function setActiveRemoteConfig(next: RemoteConfig | null): void {
  doc = next;
}

export function flagEnabled(flag: FlagKey, tier: "free" | "pro" | "diamond"): boolean {
  let version = "0.0.0";
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    version = "0.0.0";
  }
  const flags = doc?.flags ?? bundledFlags();
  return evaluateFlag(flag, flags, {
    tier,
    version,
    installId: "overlay",
    minSupportedVersion: doc?.minSupportedVersion,
  }).enabled;
}
