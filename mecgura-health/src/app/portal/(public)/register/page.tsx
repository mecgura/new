import { redirect } from "next/navigation";

/** There is no open self-registration: an account is created only by activating a code the clinic issued. */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const { clinic } = await searchParams;
  redirect(`/portal/activate${clinic ? `?clinic=${encodeURIComponent(clinic)}` : ""}`);
}
