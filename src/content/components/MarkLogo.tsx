type MarkLogoProps = {
  size?: number;
};

/** MarginMark: an M with the green line as the margin you keep. */
export default function MarkLogo({ size = 28 }: MarkLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f172a" />
      <path
        d="M7.5 23.5V10.5L16 17.5l8.5-7V23.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 27h16" stroke="#34d399" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
