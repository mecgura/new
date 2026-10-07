import { after } from "next/server";

/**
 * Runs work after the response is sent (Next's `after`). Outside a request
 * scope (scripts, tests) it simply starts the work in the background.
 */
export function runAfterResponse(task: () => Promise<unknown>) {
  const run = () => task().then(() => undefined, (e) => console.error("[background] task failed:", e));
  try {
    after(run);
  } catch {
    void run();
  }
}
