/**
 * Seller label cost counts toward margin only when the seller pays shipping
 * (not when checkout shipping is fully passed to the buyer).
 */
export function effectiveShippingPerUnit(
  shippingOut: number,
  shippingPassedToBuyer: boolean,
): number {
  return shippingPassedToBuyer ? 0 : shippingOut;
}
