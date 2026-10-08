// Plain (server-safe) helpers for clinic profile forms.
export interface ClinicProfileValues {
  name: string; legalName: string; clinicType: string; contactEmail: string; contactPhone: string; alternatePhone: string;
  address: string; city: string; state: string; country: string; pincode: string; timezone: string;
}
export const EMPTY_PROFILE: ClinicProfileValues = {
  name: "", legalName: "", clinicType: "MULTI_DOCTOR", contactEmail: "", contactPhone: "", alternatePhone: "",
  address: "", city: "", state: "", country: "India", pincode: "", timezone: "Asia/Kolkata",
};

/** Empty strings -> undefined so the server treats blank optional fields as "not set". */
export function profilePayload(v: ClinicProfileValues) {
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === "string" && val.trim() === "" ? undefined : val]));
}
export function profileFromTenant(t: Record<string, unknown>): ClinicProfileValues {
  const s = (k: string, d = "") => (typeof t[k] === "string" ? (t[k] as string) : d);
  return {
    name: s("name"), legalName: s("legalName"), clinicType: s("clinicType", "MULTI_DOCTOR"), contactEmail: s("contactEmail"), contactPhone: s("contactPhone"),
    alternatePhone: s("alternatePhone"), address: s("address"), city: s("city"), state: s("state"), country: s("country", "India"), pincode: s("pincode"), timezone: s("timezone", "Asia/Kolkata"),
  };
}
