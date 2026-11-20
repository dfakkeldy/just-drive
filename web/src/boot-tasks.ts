// Boot reads that need only the manifest start together (main.ts), and each one still waits at its own line.
// A wait on a read that has already arrived would not end the task. So `take` first gives the browser a new task:
// the boot keeps its task breaks where the network waits put them, and the first frame and Start stay responsive.

/** A boot read started early. Its failure is kept for the line that waits for it; until then it is not an unhandled
 *  rejection. After its last use the read is let go, so the parsed file is not kept for the whole page. */
export class EarlyRead<T> {
  private read: Promise<T> | null;
  /** `uses` is the number of lines that take this read. */
  constructor(read: Promise<T>, private uses: number) {
    read.catch(() => { /* the waiting line reports it */ });
    this.read = read;
  }

  /** Waits for the read in a new task, as the network wait before it did. */
  take(): Promise<T> {
    const read = this.read;
    if (!read) throw Error('A boot read was taken more often than its uses');
    if (--this.uses === 0) this.read = null;
    return inTask(read);
  }
}

/** Starts a read early, for `uses` lines that wait for it. */
export function early<T>(read: Promise<T>, uses = 1): EarlyRead<T> {
  return new EarlyRead(read, uses);
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

async function inTask<T>(read: Promise<T>): Promise<T> {
  await nextTask();
  return read;
}
