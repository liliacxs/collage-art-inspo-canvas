const SWATCH_WIDTH = 120;
const SWATCH_HEIGHT = 300;
const LABEL_HEIGHT = 40;

// Renders a palette as a strip of solid swatches with their hex codes labelled
// underneath — a plain reference image of the colours, not a UI screenshot.
export function renderPaletteToBlob(palette: string[]): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SWATCH_WIDTH * palette.length;
  canvas.height = SWATCH_HEIGHT + LABEL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  palette.forEach((hex, index) => {
    const x = index * SWATCH_WIDTH;

    ctx.fillStyle = hex;
    ctx.fillRect(x, 0, SWATCH_WIDTH, SWATCH_HEIGHT);

    ctx.fillStyle = '#111827';
    ctx.fillRect(x, SWATCH_HEIGHT, SWATCH_WIDTH, LABEL_HEIGHT);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hex.toLowerCase(), x + SWATCH_WIDTH / 2, SWATCH_HEIGHT + LABEL_HEIGHT / 2);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
