import type { ConsultationView } from "@/lib/services/consultation";

export type CView = ConsultationView;
export interface Staff { id: string; name: string; role: string }
export interface Complaint { text: string; duration?: string; severity?: string; notes?: string }
export interface Symptom { name: string; duration?: string; severity?: string; onset?: string; notes?: string }
export interface RxItem { name: string; genericName?: string; brandName?: string; strength?: string; dose?: string; route?: string; frequency?: string; morning?: boolean; afternoon?: boolean; evening?: boolean; night?: boolean; foodTiming?: string; durationDays?: number | string; quantity?: number | string; quantityUnit?: string; startDate?: string; endDate?: string; instructions?: string; medicineRefId?: string }
export interface Form {
  chiefComplaints: Complaint[]; symptoms: Symptom[]; history: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  examination: Record<string, any> & { custom?: { title: string; text: string }[] };
  assessment: string; impression: string; differential: string; assessmentNotes: string; clinicalNotes: string; advice: string;
  followUpRequired: boolean; followUpAfterDays: string; followUpDate: string; followUpNotes: string;
}
export const toForm = (c: CView): Form => ({
  chiefComplaints: c.content.chiefComplaints, symptoms: c.content.symptoms, history: c.content.history, examination: c.content.examination,
  assessment: c.content.assessment, impression: c.content.impression, differential: c.content.differential, assessmentNotes: c.content.assessmentNotes, clinicalNotes: c.content.clinicalNotes, advice: c.content.advice,
  followUpRequired: c.content.followUp.required, followUpAfterDays: c.content.followUp.afterDays ? String(c.content.followUp.afterDays) : "", followUpDate: c.content.followUp.date ?? "", followUpNotes: c.content.followUp.notes ?? "",
});
export const toPatch = (f: Form, rev: number) => ({
  rev, chiefComplaints: f.chiefComplaints, symptoms: f.symptoms, history: f.history, examination: f.examination,
  assessment: f.assessment, impression: f.impression, differential: f.differential, assessmentNotes: f.assessmentNotes, clinicalNotes: f.clinicalNotes, advice: f.advice,
  followUpRequired: f.followUpRequired, followUpAfterDays: f.followUpAfterDays ? Number(f.followUpAfterDays) : null, followUpDate: f.followUpDate, followUpNotes: f.followUpNotes,
});
