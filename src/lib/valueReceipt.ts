export function leaksFoundUsd(
  rows: Array<{ netPerUnit: number; units: number; commissionAboveSafe: number }>,
): number {
  return rows.reduce((sum, row) => {
    const loss = row.netPerUnit < 0 ? -row.netPerUnit * row.units : 0;
    const commission = Math.max(0, row.commissionAboveSafe) * row.units;
    return sum + loss + commission;
  }, 0);
}
