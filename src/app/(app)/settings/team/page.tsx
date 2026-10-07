import { redirect } from "next/navigation";

// Team management moved to /team (Phase 4).
export default function SettingsTeamRedirect() {
  redirect("/team");
}
