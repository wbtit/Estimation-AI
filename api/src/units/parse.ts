// Feet-inch (and mm) text typed by a person -> millimetres. Mirrors the Python dimension parser
// (worker/src/text_layer/parsers/dimension.py) for the forms people type: 12'-6 1/2", 12'6", 12',
// 6", 1/2", 6.5", -2'-6", and "3000 mm". Anything else is rejected, never guessed.
import { normalizeScaleText } from '../scale/index.js';
import { MM_PER_FOOT, MM_PER_INCH } from './index.js';

const INCH = String.raw`(\d+\s*[-\s]\s*\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d*\.\d+|\d+)`;
const FEET_INCHES = new RegExp(String.raw`^(-?)\s*(\d+(?:\.\d+)?)\s*'\s*-?\s*${INCH}\s*"?$`);
const FEET_ONLY = /^(-?)\s*(\d+(?:\.\d+)?)\s*'$/;
const INCHES_ONLY = new RegExp(String.raw`^(-?)\s*${INCH}\s*"$`);
const MM_ONLY = /^(-?\d+(?:\.\d+)?)\s*mm$/i;

function inchValue(text: string): number | null {
  const t = text.trim();
  let m = /^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Millimetres, or null when the text is not a recognised length. */
export function parseLengthMm(input: string): number | null {
  const t = normalizeScaleText(input).replace(/''/g, '"');
  let m = MM_ONLY.exec(t);
  if (m) return Number(m[1]);
  m = FEET_INCHES.exec(t);
  if (m) {
    const inches = inchValue(m[3]);
    if (inches === null) return null;
    const mm = Number(m[2]) * MM_PER_FOOT + inches * MM_PER_INCH;
    return m[1] === '-' ? -mm : mm;
  }
  m = FEET_ONLY.exec(t);
  if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]) * MM_PER_FOOT;
  m = INCHES_ONLY.exec(t);
  if (m) {
    const inches = inchValue(m[2]);
    return inches === null ? null : (m[1] === '-' ? -1 : 1) * inches * MM_PER_INCH;
  }
  return null;
}
