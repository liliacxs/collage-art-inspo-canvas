import { clusterImageData } from '@/editor/effects/clustering';

export interface ClusterWorkerRequest {
  requestId: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  colours: number;
}

export interface ClusterWorkerResponse {
  requestId: number;
  width: number;
  height: number;
  labelsBuffer: ArrayBuffer;
  palette: string[];
}

// Avoids depending on the `webworker` lib (which would conflict with the `DOM` lib
// the rest of the app compiles against) just to type postMessage/onmessage.
interface WorkerScope {
  postMessage(message: ClusterWorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ClusterWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { requestId, width, height, buffer, colours } = event.data;
  const data = new Uint8ClampedArray(buffer);
  const { labels, palette } = clusterImageData(data, width, height, colours);

  const labelsBuffer = labels.buffer as ArrayBuffer;
  scope.postMessage({ requestId, width, height, labelsBuffer, palette }, [labelsBuffer]);
};
