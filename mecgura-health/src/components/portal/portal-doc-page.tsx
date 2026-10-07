import { notFound } from "next/navigation";
import { PortalDocToolbar } from "./portal-doc";
import { AppError } from "@/lib/errors";
import { renderPortalDocument } from "@/lib/portal/portal-html";
import { requirePatientContext } from "@/lib/portal/ctx";
import { portalDocument } from "@/lib/services/portal-docs";

/** Server-rendered, ownership-checked document page (clinic branding, the clinic's own renderer). */
export async function PortalDocPage({ kind, id, back, version }: { kind: string; id: string; back: { href: string; label: string }; version?: number }) {
  const ctx = await requirePatientContext();
  let doc; try { doc = await portalDocument(ctx, kind, id, version); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { style, body } = renderPortalDocument(doc);
  return (
    <div>
      <PortalDocToolbar kind={kind} id={id} back={back} />
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
