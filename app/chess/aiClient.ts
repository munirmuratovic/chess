import type { AiWorkerRequest, AiWorkerResponse } from "./ai.worker";

// The worker replies to every message exactly once, in the order requests
// were sent (it's single-threaded and handles one message at a time), so a
// plain FIFO queue of resolvers is enough to pair requests with responses —
// no per-message ids needed.
export interface AiClient {
  send(request: AiWorkerRequest): Promise<AiWorkerResponse>;
  dispose(): void;
}

export function createAiClient(worker: Worker): AiClient {
  const queue: Array<(res: AiWorkerResponse) => void> = [];

  const onMessage = (e: MessageEvent<AiWorkerResponse>) => {
    queue.shift()?.(e.data);
  };
  worker.addEventListener("message", onMessage);

  return {
    send(request) {
      return new Promise((resolve) => {
        queue.push(resolve);
        worker.postMessage(request);
      });
    },
    dispose() {
      worker.removeEventListener("message", onMessage);
    },
  };
}
