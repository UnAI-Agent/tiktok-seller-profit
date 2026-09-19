import ProUpsell from "../popup/ProUpsell";

type CreatorPerformanceProps = {
  isPro: boolean;
};

export default function CreatorPerformance({ isPro }: CreatorPerformanceProps) {
  if (!isPro) {
    return (
      <div className="space-y-3">
        <ProUpsell featureLabel="Creator Performance (Pro only)" />
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">Creator performance (demo)</p>
      <div className="rounded border border-slate-200 p-2">
        <div className="flex justify-between">
          <span>@creator_demo</span>
          <span className="font-medium">$1,240 GMV / 30d</span>
        </div>
      </div>
    </div>
  );
}
