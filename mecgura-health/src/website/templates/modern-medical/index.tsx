import type { TemplateDefinition } from "../types";
import { Layout } from "./layout";
import { About, Appointments, ArticleDetail, Articles, Clinic, Contact, DoctorDetail, Doctors, Faq, Home, Legal, ServiceDetail, Services, Testimonials } from "./pages";

/** MODERN MEDICAL — the first template: clean white surfaces, brand-coloured accents, rounded cards. */
export const modernMedical: TemplateDefinition = {
  key: "MODERN_MEDICAL",
  name: "Modern Medical",
  description: "Clean, trustworthy layout for doctors and clinics.",
  components: { Layout, Home, About, Services, ServiceDetail, Doctors, DoctorDetail, Clinic, Testimonials, Faq, Articles, ArticleDetail, Contact, Legal, Appointments },
};
