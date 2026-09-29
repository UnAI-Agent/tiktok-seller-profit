import { Button } from "../../ui/primitives";

type OverlayAuthProps = {
  /** Opens the full log-in / sign-up screen. */
  onOpen: (mode: "login" | "signup") => void;
};

/** Logged-out strip under the hero. Profit on the page works either way. */
export default function OverlayAuth({ onOpen }: OverlayAuthProps) {
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <p className="text-xs leading-relaxed text-slate-600">
        <b className="text-slate-900">Profit on this page works without an account.</b> Sign in free to save costs for your products and see who is losing money.
      </p>
      <div className="mt-2.5 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => onOpen("signup")}>
          Create free account
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => onOpen("login")}>
          Log in
        </Button>
      </div>
    </div>
  );
}
