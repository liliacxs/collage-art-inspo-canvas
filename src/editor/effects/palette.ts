import { hexToRgb, type Rgb } from './colour';

// A multiply blend: each palette colour is scaled channel-wise by the filter
// colour (÷255 so white is the identity). Unlike remapping to a fixed target
// palette, this can never collapse distinct clusters onto the same colour —
// it only tints, so cluster structure always stays visible.
export function applyColourFilter(paletteHex: string[], filterHex: string | undefined): Rgb[] {
  if (!filterHex) return paletteHex.map(hexToRgb);
  const [fr, fg, fb] = hexToRgb(filterHex);
  return paletteHex.map((hex) => {
    const [r, g, b] = hexToRgb(hex);
    return [Math.round((r * fr) / 255), Math.round((g * fg) / 255), Math.round((b * fb) / 255)];
  });
}
