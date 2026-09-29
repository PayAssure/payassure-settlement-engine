export function areAmountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}
