// Unit handling. Canonical internal length unit is millimetres; feet-inches is display only.
// Conversion factors are the exact international definitions, not measured values.

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const KG_PER_LB = 0.45359237;

/** 1 lb/ft expressed in kg/m: (kg per lb) / (metres per ft). */
export const KG_PER_M_PER_LB_PER_FT = KG_PER_LB / (MM_PER_FOOT / 1000);

export function lbPerFtToKgPerM(lbPerFt: number): number {
  return lbPerFt * KG_PER_M_PER_LB_PER_FT;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Formats millimetres as feet-inches, rounded to the nearest 1/denominator inch
 * (halves round away from zero). Examples: 3810 -> 12'-6", 304.8 -> 1'-0", 12.7 -> 0'-1/2".
 */
export function mmToFeetInches(mm: number, denominator = 16): string {
  if (!Number.isFinite(mm)) throw new RangeError(`cannot format non-finite length: ${mm}`);
  if (!Number.isInteger(denominator) || denominator < 1) {
    throw new RangeError(`denominator must be a positive integer: ${denominator}`);
  }
  const negative = mm < 0;
  const units = Math.round((Math.abs(mm) / MM_PER_INCH) * denominator);
  const perFoot = 12 * denominator;
  const feet = Math.floor(units / perFoot);
  const rest = units - feet * perFoot;
  const inches = Math.floor(rest / denominator);
  const numerator = rest % denominator;

  let inchText = '';
  if (numerator === 0) {
    inchText = `${inches}`;
  } else {
    const g = gcd(numerator, denominator);
    const fraction = `${numerator / g}/${denominator / g}`;
    inchText = inches === 0 ? fraction : `${inches} ${fraction}`;
  }
  return `${negative && units !== 0 ? '-' : ''}${feet}'-${inchText}"`;
}
