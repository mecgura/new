"use client";

import * as React from "react";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <figure className="min-w-0">
      {label ? <figcaption className="mb-1 text-caption text-app-subtle">{label}</figcaption> : null}
      <pre className="app-scroll overflow-x-auto rounded-xl border border-app-border bg-app-bg p-3 font-mono text-[13px] leading-relaxed text-app-text">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
