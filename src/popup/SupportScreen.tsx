import { extensionVersion } from "../lib/reportProblem";
import SupportCenter from "./SupportCenter";

/** Popup entry. The overlay uses SupportCenter directly. */
export default function SupportScreen({ onClose }: { onClose?: () => void }) {
  return (
    <SupportCenter
      onClose={onClose ?? (() => window.close())}
      context={{ version: extensionVersion(), pageType: "popup", priceRead: false }}
      defaultKind="support"
    />
  );
}
