import type { Metadata } from "next";
import { BookAppointment } from "@/components/portal/book-appointment";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { bookingOptions } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Book appointment" };
export const dynamic = "force-dynamic";
export default async function BookPage() {
  const ctx = await requirePatientContext(); const o = await bookingOptions(ctx);
  return <div><PageTitle title="Book an appointment" back={{ href: "/portal/appointments", label: "Appointments" }} /><BookAppointment options={o} /></div>;
}
