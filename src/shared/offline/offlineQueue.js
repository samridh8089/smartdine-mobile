import { storage } from '../storage';

export class OfflineQueueManager {
  constructor(storageKey) {
    this.storageKey = storageKey;
  }

  async getQueue() {
    const queue = await storage.getItem(this.storageKey, []);
    return Array.isArray(queue) ? queue : [];
  }

  async enqueue(action) {
    const current = await this.getQueue();
    const updated = [...current, { ...action, timestamp: Date.now() }];
    await storage.setItem(this.storageKey, updated);
    return updated;
  }

  async saveQueue(queue) {
    await storage.setItem(this.storageKey, queue);
  }

  async clearQueue() {
    await storage.removeItem(this.storageKey);
  }

  async processQueue(executor) {
    const queue = await this.getQueue();
    if (queue.length === 0) return [];

    console.log(`[OfflineQueue] Processing ${queue.length} actions for ${this.storageKey}...`);
    const remaining = [];

    for (const item of queue) {
      try {
        const success = await executor(item);
        if (!success) remaining.push(item);
      } catch (e) {
        console.log('[OfflineQueue] Retry failed:', e?.message);
        remaining.push(item);
      }
    }

    await this.saveQueue(remaining);
    return remaining;
  }
}
