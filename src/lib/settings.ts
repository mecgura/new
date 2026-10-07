import { db } from "@/lib/db";

export async function getSetting(key: string, fallback = ""): Promise<string> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key } });
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string) {
  return db.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
