"use client";

/**
 * Browser side of Meta Embedded Signup. Loads the Facebook JS SDK on demand,
 * opens the onboarding popup and resolves with the authorization `code` plus
 * the WABA / phone number ids Meta posts back. The code is exchanged for a
 * token on the SERVER only (/connect/meta/complete).
 */
type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBStatic = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: FBLoginResponse) => void, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FBStatic;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FBStatic> | null = null;

export function loadMetaSdk(appId: string, version: string): Promise<FBStatic> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      return resolve(window.FB);
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Couldn't load Meta's sign-in. Check your connection or disable blockers for facebook.com."));
    };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export type SignupProgress = { step: string };
export type SignupResult =
  | { kind: "finish"; code: string; wabaId: string; phoneNumberId: string }
  | { kind: "cancel"; step: string }
  | { kind: "error"; message: string };

export async function runEmbeddedSignup(opts: {
  appId: string;
  configId: string;
  graphVersion: string;
  featureType: string;
  onProgress?: (p: SignupProgress) => void;
}): Promise<SignupResult> {
  const FB = await loadMetaSdk(opts.appId, opts.graphVersion);
  return new Promise((resolve) => {
    let ids: { wabaId: string; phoneNumberId: string } | null = null;
    let code: string | null = null;
    let settled = false;
    const finish = (r: SignupResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(r);
    };
    const tryFinish = () => {
      if (code && ids) finish({ kind: "finish", code, ...ids });
    };
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event?.startsWith("FINISH")) {
        ids = { wabaId: data.data?.waba_id ?? "", phoneNumberId: data.data?.phone_number_id ?? "" };
        opts.onProgress?.({ step: "result" });
        if (!ids.phoneNumberId) finish({ kind: "error", message: "Meta finished without a phone number. Please add a number in the flow." });
        tryFinish();
      } else if (data.event === "CANCEL") {
        finish({ kind: "cancel", step: data.data?.current_step ?? "unknown" });
      } else if (data.event === "ERROR") {
        finish({ kind: "error", message: data.data?.error_message ?? "Meta reported an error during onboarding." });
      }
    };
    window.addEventListener("message", onMessage);
    opts.onProgress?.({ step: "auth" });
    FB.login(
      (response) => {
        code = response.authResponse?.code ?? null;
        if (!code) return finish({ kind: "cancel", step: "login" });
        tryFinish();
        // Meta may deliver the session message slightly after the login callback.
        window.setTimeout(() => {
          if (!settled && code && !ids) finish({ kind: "error", message: "Meta didn't return the selected business account. Please try again." });
        }, 8000);
      },
      {
        config_id: opts.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: opts.featureType, sessionInfoVersion: "3" },
      }
    );
  });
}
