import SupportCenter from "../../popup/SupportCenter";

type ReportProblemFormProps = {
  version: string;
  pageType: string;
  priceRead: boolean;
  plan?: string;
  defaultEmail?: string;
  onClose: () => void;
  onDone?: (result: { ok: boolean; message: string }) => void;
};

/** Kept for existing imports. The bug report now lives in the Help & support screen. */
export default function ReportProblemForm({ version, pageType, priceRead, plan, defaultEmail = "", onClose }: ReportProblemFormProps) {
  return (
    <SupportCenter
      onClose={onClose}
      context={{ version, pageType, priceRead, plan }}
      defaultEmail={defaultEmail}
      defaultKind="problem"
    />
  );
}
