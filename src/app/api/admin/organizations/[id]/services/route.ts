import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, servicesUpdateSchema } from "@/lib/validations";
import { setServices } from "@/lib/services/clients";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const { services } = await readJson(req, servicesUpdateSchema);
  return ok({ services: await setServices(admin.id, id, services, req) });
});
