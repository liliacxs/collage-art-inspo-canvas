import { labToRgb, rgbToHex, rgbToLab, type Lab, type Rgb } from './colour';

const MAX_SAMPLES = 4000;
const MAX_ITERATIONS = 12;
const CONVERGENCE_EPSILON = 0.5; // Lab units

// Sentinel label for fully transparent pixels. Safe since colour counts top out at
// 32 (real labels are 0..31), so it can live in the same Uint8Array as real labels.
const TRANSPARENT_LABEL = 255;

function distanceSq(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function samplePixels(data: Uint8ClampedArray): Lab[] {
  const totalPixels = data.length / 4;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLES));
  const samples: Lab[] = [];
  for (let i = 0; i < totalPixels; i += stride) {
    const offset = i * 4;
    if (data[offset + 3] === 0) continue; // skip fully transparent pixels
    samples.push(rgbToLab(data[offset], data[offset + 1], data[offset + 2]));
  }
  return samples;
}

// Deterministic farthest-point (greedy k-center) seeding: reproducible for the same
// image + k (no RNG), and spreads centroids across the actual colour distribution
// instead of clumping, which is what makes the live "4 -> 32 colours" slider feel
// like a stable refinement rather than a jump to unrelated colours each tick.
function seedCentroids(samples: Lab[], k: number): Lab[] {
  if (samples.length === 0) return [];

  const centroids: Lab[] = [samples[0]];
  const nearestDistSq = new Array(samples.length).fill(Infinity);

  while (centroids.length < Math.min(k, samples.length)) {
    const latest = centroids[centroids.length - 1];
    let farthestIndex = 0;
    let farthestDist = -1;
    for (let i = 0; i < samples.length; i++) {
      const d = distanceSq(samples[i], latest);
      if (d < nearestDistSq[i]) nearestDistSq[i] = d;
      if (nearestDistSq[i] > farthestDist) {
        farthestDist = nearestDistSq[i];
        farthestIndex = i;
      }
    }
    centroids.push(samples[farthestIndex]);
  }
  return centroids;
}

function runKMeans(samples: Lab[], k: number): Lab[] {
  let centroids = seedCentroids(samples, k);
  if (centroids.length === 0) return centroids;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const sums = centroids.map(() => [0, 0, 0]);
    const counts = new Array(centroids.length).fill(0);

    for (const sample of samples) {
      let bestIndex = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distanceSq(sample, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = c;
        }
      }
      sums[bestIndex][0] += sample[0];
      sums[bestIndex][1] += sample[1];
      sums[bestIndex][2] += sample[2];
      counts[bestIndex]++;
    }

    let maxShift = 0;
    const next: Lab[] = centroids.map((centroid, i) => {
      if (counts[i] === 0) return centroid; // keep empty clusters in place rather than collapsing them
      const mean: Lab = [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]];
      maxShift = Math.max(maxShift, Math.sqrt(distanceSq(mean, centroid)));
      return mean;
    });

    centroids = next;
    if (maxShift < CONVERGENCE_EPSILON) break;
  }

  return centroids;
}

// Nearest-centroid label per pixel. Flat/illustration-style source images repeat
// exact RGB values constantly; caching the lookup per distinct colour avoids
// re-searching every single pixel and is a large win on that common case.
function assignLabels(data: Uint8ClampedArray, centroids: Lab[]): Uint8Array {
  const pixelCount = data.length / 4;
  const labels = new Uint8Array(pixelCount);
  const cache = new Map<number, number>();

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    if (data[i + 3] === 0 || centroids.length === 0) {
      labels[p] = TRANSPARENT_LABEL;
      continue;
    }

    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let bestIndex = cache.get(key);
    if (bestIndex === undefined) {
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      bestIndex = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distanceSq(lab, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = c;
        }
      }
      cache.set(key, bestIndex);
    }
    labels[p] = bestIndex;
  }

  return labels;
}

// A 3x3 majority (mode) filter over cluster labels, not colours: it only ever
// reassigns a pixel to a label one of its neighbours already has, so it can't
// introduce off-palette colours, only clean up isolated pixels that flipped to a
// different cluster than the region around them. That's the actual mechanism
// behind low-k graininess — quantization is otherwise per-pixel and ignores
// neighbours entirely, so pixels near a cluster boundary (which covers more of the
// image's colour range when k is small) speckle independently of their neighbours.
function despeckleLabels(labels: Uint8Array, width: number, height: number, clusterCount: number, passes: number): Uint8Array {
  let current = labels;
  const counts = new Int32Array(clusterCount);

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(current.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const ownLabel = current[idx];
        if (ownLabel === TRANSPARENT_LABEL) {
          next[idx] = TRANSPARENT_LABEL;
          continue;
        }

        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const neighbourLabel = current[ny * width + nx];
            if (neighbourLabel !== TRANSPARENT_LABEL) counts[neighbourLabel]++;
          }
        }

        let bestLabel = ownLabel;
        let bestCount = counts[ownLabel];
        for (let c = 0; c < clusterCount; c++) {
          if (counts[c] > bestCount) {
            bestCount = counts[c];
            bestLabel = c;
          }
        }
        next[idx] = bestLabel;
      }
    }
    current = next;
  }

  return current;
}

// Graininess is worst at low colour counts (few, large Voronoi cells in colour
// space mean more of the image sits near a boundary), so smooth harder there and
// back off as colour count rises and per-cluster precision matters more.
function despecklePassesFor(colours: number): number {
  if (colours < 14) return 2;
  if (colours < 20) return 1;
  return 0;
}

export interface ClusterResult {
  labels: Uint8Array;
  width: number;
  height: number;
  palette: string[];
}

// Computes which cluster each pixel belongs to, and a default palette (the
// clusters' own centroid colours, dark -> light). Does NOT bake pixels — the
// labels are the reusable, expensive-to-compute part; turning them into an actual
// image (via `recolorLabels`) is cheap and redone on the main thread whenever the
// palette changes (edited by hand, or a different palette applied), without
// re-running k-means.
export function clusterImageData(data: Uint8ClampedArray, width: number, height: number, colours: number): ClusterResult {
  const samples = samplePixels(data);
  const unsortedCentroids = runKMeans(samples, colours);

  // Sort once, up front, so label indices already match the palette's dark -> light
  // display order — no separate remapping needed downstream.
  const centroids = [...unsortedCentroids].sort((a, b) => a[0] - b[0]);
  const palette = centroids.map((lab) => rgbToHex(labToRgb(...lab)));

  const rawLabels = assignLabels(data, centroids);
  const passes = despecklePassesFor(colours);
  const labels = passes > 0 ? despeckleLabels(rawLabels, width, height, centroids.length, passes) : rawLabels;

  return { labels, width, height, palette };
}

// The cheap half of the pipeline: turns cluster labels + a palette (the default one,
// a hand-edited one, or an entirely different applied one) into actual pixels.
export function recolorLabels(labels: Uint8Array, width: number, height: number, palette: Rgb[]): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < labels.length; p++) {
    const i = p * 4;
    const label = labels[p];
    if (label === TRANSPARENT_LABEL || !palette[label]) continue; // stays [0,0,0,0]
    const [r, g, b] = palette[label];
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}
