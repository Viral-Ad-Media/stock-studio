import type { ParsedSignal } from "./signals";
export type Delivery = {
  signal: ParsedSignal & { id: number; posted_at: string | Date };
  destination: string;
  attempts: number;
  lease_token: string;
};
export type DeliveryStore = {
  claim(): Promise<Delivery | null>;
  finish(item: Delivery, externalId: string): Promise<boolean>;
  retry(item: Delivery, error: string): Promise<void>;
};
// The database owns retry state and leases, so a process restart loses no work.
export async function drainDeliveries(store: DeliveryStore, send: (item: Delivery) => Promise<string>, limit = 20) {
  for (let i = 0; i < limit; i++) {
    const item = await store.claim();
    if (!item) return;
    try {
      const externalId = await send(item);
      if (!await store.finish(item, externalId)) throw new Error("Delivery lease expired before completion");
    } catch (error) {
      await store.retry(item, error instanceof Error ? error.message : String(error));
    }
  }
}
