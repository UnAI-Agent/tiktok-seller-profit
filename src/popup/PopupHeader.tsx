import { emailInitials } from "../lib/emailInitials";

type PopupHeaderProps = {
  onClose: () => void;
  onLoginClick: () => void;
  onSupportClick: () => void;
  onLogout?: () => void;
  isLoggedIn?: boolean;
  userEmail?: string | null;
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
  /** Splash / gate — only show close */
  minimal?: boolean;
};

function IconUser({ filled }: { filled?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" fill={filled ? "currentColor" : "none"} />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
    </svg>
  );
}

function IconSupport() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20v-0.75a6.5 6.5 0 0 1 13 0V20" />
      <path d="M4 12.5a8 8 0 0 1 16 0" />
      <path d="M4 12.5v2a2 2 0 0 0 2 2h1" />
      <path d="M20 12.5v2a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

export default function PopupHeader({
  onClose,
  onLoginClick,
  onSupportClick,
  onLogout,
  isLoggedIn,
  userEmail,
  showBack,
  onBack,
  title = "TikTok Seller Tool",
  minimal = false,
}: PopupHeaderProps) {
  if (minimal) {
    return (
      <header className="flex items-center justify-end border-b border-slate-200 pb-3">
        <button
          type="button"
          aria-label="Close"
          className="rounded p-1 text-xl leading-none text-slate-500 hover:bg-slate-100"
          onClick={onClose}
        >
          ×
        </button>
      </header>
    );
  }

  return (
    <header className="flex items-center gap-2 border-b border-slate-200 pb-3">
      {showBack ? (
        <button
          type="button"
          className="shrink-0 rounded px-1 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
          onClick={onBack}
        >
          ←
        </button>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tiktok text-xs font-bold text-white">
          {isLoggedIn && userEmail ? emailInitials(userEmail) : "TT"}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-center text-sm font-semibold text-slate-900">
          {title}
        </h1>
        {isLoggedIn && userEmail && (
          <p className="truncate text-center text-[10px] text-slate-500" title={userEmail}>
            {userEmail}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {isLoggedIn && onLogout && (
          <button
            type="button"
            className="rounded px-1.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onLogout}
          >
            Log out
          </button>
        )}
        <button
          type="button"
          aria-label={isLoggedIn ? "Account" : "Log in"}
          title={isLoggedIn ? userEmail || "Account" : "Log in"}
          className={`rounded p-1.5 hover:bg-slate-100 ${
            isLoggedIn ? "text-tiktok" : "text-slate-600"
          }`}
          onClick={onLoginClick}
        >
          <IconUser filled={isLoggedIn} />
        </button>
        <button
          type="button"
          aria-label="Support"
          title="Support"
          className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
          onClick={onSupportClick}
        >
          <IconSupport />
        </button>
        <button
          type="button"
          aria-label="Close"
          className="rounded p-1 text-xl leading-none text-slate-500 hover:bg-slate-100"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </header>
  );
}
