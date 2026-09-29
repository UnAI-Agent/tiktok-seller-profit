import { PRIVACY_URL, PUBLISHER_NAME, TERMS_URL } from "../config";

export default function LegalFooter() {
  return (
    <p className="text-center text-[10px] leading-relaxed text-slate-500">
      MarginMark by {PUBLISHER_NAME}
      {" · "}
      <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">
        Privacy
      </a>
      {" · "}
      <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">
        Terms
      </a>
    </p>
  );
}
