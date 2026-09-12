import type { ClusterWorkerRequest, ClusterWorkerResponse } from '@/workers/clustering.worker';

export interface ClusterComputeResult {
  imageData: ImageData;
  palette: string[];
}

interface PendingRequest {
  resolve: (result: ClusterComputeResult) => void;
}

export class ClusteringClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/clustering.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<ClusterWorkerResponse>) => {
      const { requestId, width, height, buffer, palette } = event.data;
      const request = this.pending.get(requestId);
      if (!request) return; // cancelled or superseded; drop silently
      this.pending.delete(requestId);
      request.resolve({ imageData: new ImageData(new Uint8ClampedArray(buffer), width, height), palette });
    };
  }

  // Caller must not read `imageData` again after calling this — its buffer is
  // transferred to the worker, not copied.
  compute(imageData: ImageData, colours: number): { requestId: number; promise: Promise<ClusterComputeResult> } {
    const requestId = this.nextRequestId++;
    const request: ClusterWorkerRequest = {
      requestId,
      width: imageData.width,
      height: imageData.height,
      buffer: imageData.data.buffer,
      colours,
    };
    const promise = new Promise<ClusterComputeResult>((resolve) => {
      this.pending.set(requestId, { resolve });
    });
    this.worker.postMessage(request, [request.buffer]);
    return { requestId, promise };
  }

  cancel(requestId: number) {
    this.pending.delete(requestId);
  }

  dispose() {
    this.pending.clear();
    this.worker.terminate();
  }
}
