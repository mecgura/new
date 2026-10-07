"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ds";

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer aria-hidden="true" /> Print / save as PDF
    </Button>
  );
}
