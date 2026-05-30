/**
 * Print-size catalogue. 300 DPI is mandatory across the line — that's the
 * minimum sharpness for ink on quality paper. Anything less looks soft.
 *
 * Sizes are stored in INCHES (canonical print unit in the US/EU framing
 * market). Conversion helpers expose mm/pt/px on demand.
 *
 * Source: T1 trend research / standard frame catalogue. Adjust here and
 * every downstream consumer picks it up.
 */
export interface PrintSize {
  /** Stable identifier. Used in zip filenames + entitlement records. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Physical width in inches. */
  widthIn: number;
  /** Physical height in inches. */
  heightIn: number;
}

export const DPI = 300;

export const PRINT_SIZES: readonly PrintSize[] = [
  // ISO A series (approx — exact mm conversion in helpers).
  { id: 'a4',          label: 'A4 (210 x 297 mm)',         widthIn: 8.27,  heightIn: 11.69 },
  { id: 'a3',          label: 'A3 (297 x 420 mm)',         widthIn: 11.69, heightIn: 16.54 },
  { id: 'us-letter',   label: 'US Letter (8.5 x 11 in)',   widthIn: 8.5,   heightIn: 11.0  },
  { id: '12x16',       label: '12 x 16 in',                widthIn: 12.0,  heightIn: 16.0  },
  { id: '16x20',       label: '16 x 20 in',                widthIn: 16.0,  heightIn: 20.0  },
  { id: '18x24',       label: '18 x 24 in',                widthIn: 18.0,  heightIn: 24.0  },
] as const;

/** 1 PDF point = 1/72 inch. pdf-lib expects pages in points. */
export function inchesToPoints(inches: number): number {
  return inches * 72;
}

/** Pixels needed to satisfy DPI at a given physical size. */
export function inchesToPixels(inches: number, dpi: number = DPI): number {
  return Math.round(inches * dpi);
}
