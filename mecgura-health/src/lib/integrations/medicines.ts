/**
 * Medicine data sources. No medicine database is built in or seeded, and none is invented; an online source can be switched on with MEDICINE_ONLINE_SEARCH.
 * To connect a real source (a licensed drug database or API), implement `MedicineSource` and set `externalMedicineSource`.
 * Until then search uses only the clinic's own imported list (MedicineReference), which starts empty.
 */
export interface MedicineHit { name: string; genericName?: string | null; brandName?: string | null; strength?: string | null; form?: string | null }
export interface MedicineSource { name: string; search(query: string, limit: number): Promise<MedicineHit[]> }
import { rxNormSource } from "./medicine-sources/rxnorm";
/**
 * Opt-in: set MEDICINE_ONLINE_SEARCH=rxnorm to search the public RxNorm vocabulary (U.S. National Library of Medicine) as you type. Off by default,
 * so nothing leaves the server unless the platform owner turns it on. Only the typed medicine text is sent.
 */
export const externalMedicineSource: MedicineSource | null = process.env.MEDICINE_ONLINE_SEARCH === "rxnorm" ? rxNormSource : null;

/** Diagnosis terminology (e.g. ICD) — also NOT configured. Doctors enter diagnoses manually; the interface is the future hook. */
export interface DiagnosisHit { name: string; code: string; codeSystem: string }
export interface DiagnosisSource { name: string; search(query: string, limit: number): Promise<DiagnosisHit[]> }
export const externalDiagnosisSource = null as DiagnosisSource | null;

/** Drug-interaction / allergy-check source — NOT configured. The UI therefore never claims a medicine is safe or unsafe. */
export interface SafetyCheckSource { name: string }
export const externalSafetySource = null as SafetyCheckSource | null;
