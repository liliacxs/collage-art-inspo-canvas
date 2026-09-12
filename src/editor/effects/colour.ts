export type Rgb = [number, number, number];
export type Lab = [number, number, number];

// D65 reference white.
const WHITE_X = 0.95047;
const WHITE_Y = 1;
const WHITE_Z = 1.08883;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const v = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : t / (108 / 841) + 4 / 29;
}

function labFInverse(t: number): number {
  return t ** 3 > 216 / 24389 ? t ** 3 : (t - 4 / 29) * (108 / 841);
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / WHITE_X;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) / WHITE_Y;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / WHITE_Z;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labFInverse(fx) * WHITE_X;
  const y = labFInverse(fy) * WHITE_Y;
  const z = labFInverse(fz) * WHITE_Z;

  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}
