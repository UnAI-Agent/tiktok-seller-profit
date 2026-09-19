import { API_BASE_URL } from "../config";
import {
  FacebookLogo,
  GoogleLogo,
  TikTokLogo,
} from "./SocialBrandIcons";

type SocialAuthButtonsProps = {
  mode: "login" | "signup";
  disabled?: boolean;
  onNotice: (message: string) => void;
};

const PROVIDERS = [
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

export default function SocialAuthButtons({
  mode,
  disabled,
  onNotice,
}: SocialAuthButtonsProps) {
  function openOAuth(provider: string, label: string) {
    const path = `/auth/oauth/${provider}?mode=${mode}`;
    onNotice(
      `Connecting to ${label}… If OAuth isn’t live yet, use email or phone below.`,
    );
    void chrome.tabs.create({ url: `${API_BASE_URL}${path}` });
  }

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {PROVIDERS.map((p) => {
        const Icon = p.icon;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-label={`${mode === "login" ? "Log in" : "Sign up"} with ${p.label}`}
            title={p.label}
            className={`flex h-12 items-center justify-center rounded-xl transition disabled:opacity-45 ${p.className}`}
            onClick={() => openOAuth(p.id, p.label)}
          >
            <Icon size={p.id === "tiktok" ? 24 : 22} />
          </button>
        );
      })}
    </div>
  );
}
