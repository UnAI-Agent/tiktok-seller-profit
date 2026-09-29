import { useEffect, useState } from "react";
import { API_BASE_URL } from "../config";
import { fetchAuthProviders } from "../lib/apiClient";
import { sendMessage } from "../lib/messages";
import {
  FacebookLogo,
  GoogleLogo,
  TikTokLogo,
} from "./SocialBrandIcons";

type SocialAuthButtonsProps = {
  mode: "login" | "signup";
  disabled?: boolean;
  onNotice: (message: string) => void;
  /** Lets the parent hide the "or email" divider when no provider is configured. */
  onAvailability?: (any: boolean) => void;
};

export const SIGN_IN_PROVIDERS = [
  {
    id: "google",
    label: "Google",
    className:
      "border border-slate-200/80 bg-white text-slate-800 shadow-sm hover:bg-slate-50 hover:shadow",
    icon: GoogleLogo,
  },
  {
    id: "facebook",
    label: "Facebook",
    className:
      "border border-[#166FE5] bg-[#1877F2] text-white shadow-sm hover:bg-[#166FE5]",
    icon: FacebookLogo,
  },
  {
    id: "tiktok",
    label: "TikTok",
    className:
      "border border-black bg-black text-white shadow-sm hover:bg-neutral-900",
    icon: TikTokLogo,
  },
] as const;

/** Only providers the API has credentials for. Offline or unknown means no social buttons, never a dead end. */
export function visibleProviders(enabled: readonly string[] | null) {
  if (!enabled) return [];
  return SIGN_IN_PROVIDERS.filter((provider) => enabled.includes(provider.id));
}

export default function SocialAuthButtons({
  mode,
  disabled,
  onNotice,
  onAvailability,
}: SocialAuthButtonsProps) {
  const [enabled, setEnabled] = useState<string[] | null>(null);

  useEffect(() => {
    let cancel = false;
    void fetchAuthProviders()
      .then((list) => {
        if (!cancel) setEnabled(list);
      })
      .catch(() => {
        if (!cancel) setEnabled([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const providers = visibleProviders(enabled);
  useEffect(() => {
    onAvailability?.(providers.length > 0);
  }, [providers.length, onAvailability]);

  function openOAuth(provider: string, label: string) {
    const url = new URL(`${API_BASE_URL}/auth/oauth/${provider}`);
    url.searchParams.set("mode", mode);
    url.searchParams.set("client", chrome.runtime.id);
    onNotice(`Connecting to ${label}…`);
    void sendMessage({ type: "START_OAUTH", url: url.toString() });
  }

  if (providers.length === 0) return null;

  return (
    <div className={`grid gap-2.5 ${providers.length === 1 ? "grid-cols-1" : providers.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {providers.map((p) => {
        const Icon = p.icon;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-label={`${mode === "login" ? "Log in" : "Sign up"} with ${p.label}`}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-45 ${p.className}`}
            onClick={() => openOAuth(p.id, p.label)}
          >
            <Icon size={p.id === "tiktok" ? 22 : 20} />
            {providers.length === 1 ? `Continue with ${p.label}` : null}
          </button>
        );
      })}
    </div>
  );
}
