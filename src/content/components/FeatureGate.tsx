import type { ReactNode } from "react";
import type { FeatureState } from "../../lib/remoteConfig";
import { safeUrl } from "../../lib/safeUrl";

export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureState;
  children: ReactNode;
}) {
  if (feature.enabled) return children;
  return (
    <div className="opacity-50" aria-disabled="true">
      {children}
      <button type="button" className="ml-1 text-xs" title={feature.reason} aria-label={feature.reason}>
        i
      </button>
      {feature.statusUrl ? (
        <a href={safeUrl(feature.statusUrl)} className="ml-1 text-xs underline">
          Status
        </a>
      ) : null}
    </div>
  );
}

export function UpdateBanner({ required }: { required: boolean }) {
  if (!required) return null;
  return <p className="text-xs font-medium text-amber-800">Please update MarginMark</p>;
}
