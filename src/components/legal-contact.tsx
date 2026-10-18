import { siteConfig } from "@/config/site";

/** Support contact line for the legal pages; says so plainly when no contact address is configured. */
export function LegalContact() {
  const { email, whatsapp } = siteConfig.contact;
  if (!email && !whatsapp) return <>your account administrator</>;
  return (
    <>
      {email ? <a href={`mailto:${email}`}>{email}</a> : null}
      {email && whatsapp ? " or WhatsApp " : null}
      {whatsapp ? <a href={`https://wa.me/${whatsapp}`}>+{whatsapp}</a> : null}
    </>
  );
}
