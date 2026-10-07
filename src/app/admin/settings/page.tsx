"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, CheckCircle2, AlertCircle, KeyRound, CreditCard, PlugZap } from "lucide-react";
import { changePasswordSchema, razorpayConfigSchema, type ChangePasswordInput, type RazorpayConfigInput } from "@/lib/validations";
import { Input, Label, FieldError } from "@/components/ui/form";

function PasswordSection() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function onSubmit(data: ChangePasswordInput) {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setMessage(body.error ?? "Could not change password.");
        setStatus("error");
        return;
      }
      setMessage(body.message ?? "Password changed successfully.");
      setStatus("success");
      reset();
    } catch {
      setMessage("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="password-heading" className="rounded-2xl border border-[#DFE8DF] dark:border-[#262633] bg-[#F2F7F2] dark:bg-[#12121A] p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-400/15 text-brand-700 dark:text-brand-300">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h2 id="password-heading" className="font-display text-lg font-semibold text-[#0C160D] dark:text-[#f4f4f6]">Change password</h2>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-4" aria-label="Change password form">
        <div>
          <Label htmlFor="currentPassword">Current password *</Label>
          <Input id="currentPassword" type="password" autoComplete="current-password" {...register("currentPassword")} aria-invalid={!!errors.currentPassword} />
          <FieldError message={errors.currentPassword?.message} />
        </div>
        <div>
          <Label htmlFor="newPassword">New password (min 8 characters) *</Label>
          <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} aria-invalid={!!errors.newPassword} />
          <FieldError message={errors.newPassword?.message} />
        </div>
        {status === "success" ? (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {message}
          </p>
        ) : null}
        {status === "error" ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {message}
          </p>
        ) : null}
        <button type="submit" disabled={status === "loading"} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-400 font-semibold text-[#062026] hover:bg-brand-300 disabled:opacity-60 sm:w-auto sm:px-8">
          {status === "loading" ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Updating…</> : "Update password"}
        </button>
      </form>
    </section>
  );
}

function RazorpaySection() {
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState<{ keyId: string; hasKeyId: boolean; mode: string; secretConfigured: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.input<typeof razorpayConfigSchema>, unknown, RazorpayConfigInput>({
    resolver: zodResolver(razorpayConfigSchema),
    defaultValues: { keyId: "", mode: "test" },
  });

  useEffect(() => {
    fetch("/api/admin/settings/razorpay")
      .then(async (r) => {
        if (!r.ok) throw new Error("load failed");
        const body = (await r.json()) as { config: { keyId: string; hasKeyId: boolean; mode: string; secretConfigured: boolean } };
        setInfo(body.config);
        reset({ keyId: "", mode: (body.config.mode === "live" ? "live" : "test") as "test" | "live" });
        setStatus("idle");
      })
      .catch(() => {
        setMessage("Could not load Razorpay config. Please refresh.");
        setStatus("error");
      });
  }, [reset]);

  async function onSubmit(data: RazorpayConfigInput) {
    setStatus("saving");
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings/razorpay", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.keyId ? data : { mode: data.mode, keyId: "" }),
      });
      const body = (await res.json()) as { error?: string; mode?: string; hasKeyId?: boolean };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setMessage(
        data.keyId
          ? `Razorpay ${body.mode} mode saved. Secret stays in .env (never stored here).`
          : "Razorpay Key ID cleared — online payments are now disabled."
      );
      setStatus("success");
      setInfo((prev) => (prev ? { ...prev, hasKeyId: Boolean(body.hasKeyId), mode: body.mode ?? prev.mode } : prev));
      reset({ keyId: "", mode: data.mode });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
      setStatus("error");
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult("");
    try {
      const res = await fetch("/api/admin/settings/razorpay/status");
      const body = (await res.json()) as { ok?: boolean; message?: string };
      setTestResult(body.message ?? (body.ok ? "Connected." : "Failed."));
    } catch {
      setTestResult("Could not reach the server. Try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section aria-labelledby="razorpay-heading" className="rounded-2xl border border-[#DFE8DF] dark:border-[#262633] bg-[#F2F7F2] dark:bg-[#12121A] p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-400/15 text-brand-700 dark:text-brand-300">
          <CreditCard className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="razorpay-heading" className="font-display text-lg font-semibold text-[#0C160D] dark:text-[#f4f4f6]">Razorpay payments</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Accept online payments on the website.</p>
        </div>
      </div>

      {info ? (
        <dl className="mt-5 grid gap-2 rounded-xl border border-[#E6EEE6] dark:border-[#1c1c28] bg-white dark:bg-[#12121A] p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Key ID</dt><dd className="mt-0.5 text-[#0C160D] dark:text-[#f4f4f6]">{info.hasKeyId ? info.keyId : "Not set"}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Mode</dt><dd className="mt-0.5 capitalize text-[#0C160D] dark:text-[#f4f4f6]">{info.mode}</dd></div>
          <div><dt className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Key Secret (.env)</dt><dd className="mt-0.5 text-[#0C160D] dark:text-[#f4f4f6]">{info.secretConfigured ? "Configured" : "Missing"}</dd></div>
        </dl>
      ) : null}

      {status === "loading" ? (
        <p className="mt-5 text-sm text-[#5C6E5F] dark:text-[#A7A7B8]" aria-live="polite">Loading Razorpay config…</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-4" aria-label="Razorpay config form">
          <div>
            <Label htmlFor="rzp-key">Key ID (leave blank to disconnect)</Label>
            <Input id="rzp-key" placeholder="rzp_test_…" autoComplete="off" {...register("keyId")} aria-invalid={!!errors.keyId} />
            <FieldError message={errors.keyId?.message} />
          </div>
          <div>
            <Label htmlFor="rzp-mode">Mode</Label>
            <select id="rzp-mode" {...register("mode")} className="flex h-11 w-full rounded-lg border border-[#DFE8DF] dark:border-[#262633] bg-white dark:bg-[#12121A] px-3.5 text-sm text-[#0C160D] dark:text-[#f4f4f6] focus:border-brand-400/70 focus:outline-none">
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
            <FieldError message={errors.mode?.message} />
          </div>
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Key Secret is read only from <code className="rounded bg-black/5 dark:bg-white/5 px-1">RAZORPAY_KEY_SECRET</code> in
            <code className="rounded bg-black/5 dark:bg-white/5 px-1"> .env</code> — paste a new Key ID above to rotate keys.
            Use <strong>test</strong> mode until you go live.
          </p>
          {status === "success" ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {message}
            </p>
          ) : null}
          {status === "error" && message ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {message}
            </p>
          ) : null}
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button type="submit" disabled={status === "saving"} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand-400 px-8 font-semibold text-[#062026] hover:bg-brand-300 disabled:opacity-60">
              {status === "saving" ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving…</> : "Save Razorpay config"}
            </button>
            <button type="button" onClick={() => void testConnection()} disabled={testing} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#CBD6CB] dark:border-[#2c2c3a] px-6 text-sm font-semibold text-[#0C160D] dark:text-[#f4f4f6] hover:border-brand-400/50 disabled:opacity-60">
              {testing ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Testing…</> : <><PlugZap className="size-4" aria-hidden="true" /> Test connection</>}
            </button>
          </div>
          {testResult ? <p role="status" className="text-sm text-[#42553F] dark:text-[#C6C6CF]">{testResult}</p> : null}
        </form>
      )}
    </section>
  );
}


export default function AdminSettingsPage() {
  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-black dark:text-[#f4f4f6] sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-black dark:text-[#f4f4f6]">Payment gateway and account security. Plans, invoicing and tax live under Billing &amp; Plans.</p>
      </div>
      <RazorpaySection />
      <PasswordSection />
    </div>
  );
}
