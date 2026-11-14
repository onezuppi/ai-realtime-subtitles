import type { FromWorker } from '../protocol';

export const post = (message: FromWorker) => self.postMessage(message);
