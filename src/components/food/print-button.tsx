"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ds";

export function PrintButton() {
  return <Button onClick={() => window.print()}><Printer aria-hidden="true" /> Print</Button>;
}
