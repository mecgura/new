import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request scratch space. `apiRoute` opens it; `readJson` copies the optional `mfaCode` of a sensitive request into it so step-up checks can see it without every service signature changing. */
export interface RequestScratch { mfaCode?: string }
export const requestStore = new AsyncLocalStorage<RequestScratch>();
export const currentMfaCode = () => requestStore.getStore()?.mfaCode;
