import { redirect } from "next/navigation";

// The platform has no public landing page: signed-in users go to the workspace, everyone else to the sign-in (proxy.ts).
export default function Home() {
  redirect("/dashboard");
}
