// Boot reads that need only the manifest start together (main.ts), and each one still waits at its own line.
// A wait on a read that has already arrived would not end the task. So `inTask` first gives the browser a new task:
// the boot keeps its task breaks where the network waits put them, and the first frame and Start stay responsive.

/** Starts a read early. Its failure is kept for the line that waits for it; until then it is not an unhandled rejection. */
export function early<T>(read: Promise<T>): Promise<T> {
  read.catch(() => { /* the waiting line reports it */ });
  return read;
}

/** A new task. scheduler.yield where it exists; otherwise a message, which a hidden tab does not hold back as it does a timer. */
export function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

/** Waits for an early read in a new task, as the network wait before it did. */
export async function inTask<T>(read: Promise<T>): Promise<T> {
  await nextTask();
  return read;
}
