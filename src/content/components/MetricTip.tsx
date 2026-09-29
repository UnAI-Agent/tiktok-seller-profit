import { HoverTip } from "./FieldHelp";

export function MetricTip({ text, align = "start" }: { text: string; align?: "start" | "end" }) {
  return (
    <span className="ml-0.5 inline-flex align-middle">
      <HoverTip text={text} align={align} />
    </span>
  );
}
