import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function base(size: number, className: string | undefined, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const LockIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const CheckIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const XIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M6 6l12 12M18 6L6 18" />);
export const MinusIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M6 12h12" />);
export const ArrowUpIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M12 19V5m-6 6l6-6 6 6" />);
export const ArrowDownIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M12 5v14m-6-6l6 6 6-6" />);
export const ChevronDownIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M6 9l6 6 6-6" />);
export const ChevronLeftIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M15 6l-6 6 6 6" />);
export const ChevronRightIcon = ({ size = 16, className }: IconProps) => base(size, className, <path d="M9 6l6 6-6 6" />);
export const UserIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><circle cx="12" cy="8" r="3.5" /><path d="M5 19c1.2-3 3.6-4.5 7-4.5S17.8 16 19 19" /></>);
export const HelpIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.6 2.6 0 0 1 5 1c0 1.7-2.6 2-2.6 3.6M12 17h.01" /></>);
export const BugIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><rect x="8" y="8" width="8" height="11" rx="4" /><path d="M9 8a3 3 0 0 1 6 0M4 13h4m8 0h4M5 7l3 2m11-2l-3 2M5 19l3-2m11 2l-3-2" /></>);
export const ChatIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />);
export const CardIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>);
export const SparkIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />);
export const RefreshIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M20 11a8 8 0 0 0-14.5-3.5L4 9" /><path d="M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15" /><path d="M20 20v-5h-5" /></>);
export const ShieldIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>);
export const MailIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const EyeIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOffIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.3-1" /></>);
export const LightbulbIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>);
export const ExternalIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>);
export const SettingsIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const BoxIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M12 3l8 4v10l-8 4-8-4V7z" /><path d="M4 7l8 4 8-4M12 11v10" /></>);
export const ChartIcon = ({ size = 16, className }: IconProps) =>
  base(size, className, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
