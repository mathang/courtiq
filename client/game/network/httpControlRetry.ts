import type { ClientToServerMessage, ServerToClientMessage } from '../../../shared/protocol/messages';

/** These confirmations are idempotent on the authoritative server. Never replay play/answer intents. */
function confirmationKey(message: ClientToServerMessage): string | null {
  if (message.type === 'SET_READY') return 'ready';
  if (message.type === 'CONTINUE_FEEDBACK') return `continue:${message.duelId}`;
  return null;
}

export function isTransientRoomMiss(message: ServerToClientMessage): boolean {
  return message.type === 'ERROR' &&
    (message.message === 'Not currently in a room.' || message.message === 'Room no longer exists.');
}

/** At most three retries per confirmation object; a newer queued choice always wins. */
export class HttpControlRetry {
  private attempts = new WeakMap<ClientToServerMessage, number>();

  reset(): void { this.attempts = new WeakMap(); }

  recover(batch: ClientToServerMessage[], queued: ClientToServerMessage[]): {
    queue: ClientToServerMessage[]; requeued: number;
  } {
    const occupied = new Set(queued.map(confirmationKey).filter((key): key is string => key !== null));
    const retries: ClientToServerMessage[] = [];
    for (const message of [...batch].reverse()) {
      const key = confirmationKey(message);
      if (!key || occupied.has(key)) continue;
      occupied.add(key);
      const attempts = this.attempts.get(message) ?? 0;
      if (attempts >= 3) continue;
      this.attempts.set(message, attempts + 1);
      retries.unshift(message);
    }
    return { queue: [...retries, ...queued], requeued: retries.length };
  }
}
