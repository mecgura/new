import type { TemplateDef } from "@/lib/templates";

/** Starter content for a business type. Applying a pack only adds drafts: tags, a paused-until-reviewed AI agent and unsubmitted templates. Nothing is sent to customers or Meta. */
export type IndustryPack = {
  id: string;
  name: string;
  description: string;
  tags: { name: string; color: string }[];
  agent: { name: string; instructions: string; faqs: { q: string; a: string }[] };
  templates: Pick<TemplateDef, "name" | "category" | "body" | "footer" | "examples">[];
};

const T = (name: string, category: "UTILITY" | "MARKETING", body: string, examples: string[], footer = "") => ({ name, category, body, footer, examples: { body: examples } });

export const INDUSTRY_PACKS: IndustryPack[] = [
  {
    id: "clinic",
    name: "Clinic / Doctor",
    description: "Appointment reminders, follow-ups and answers to common patient questions.",
    tags: [
      { name: "New patient", color: "emerald" },
      { name: "Follow-up due", color: "amber" },
      { name: "Appointment booked", color: "sky" },
    ],
    agent: {
      name: "Clinic assistant",
      instructions: "You answer for a medical clinic. Be polite and brief. Never give medical advice or diagnoses; for symptoms or emergencies tell the patient to call the clinic or visit the nearest hospital. Collect name and preferred time for appointments and hand over to the reception team.",
      faqs: [
        { q: "What are your timings?", a: "Please replace this answer with your clinic timings." },
        { q: "How do I book an appointment?", a: "Tell us your name, the doctor you want to see and your preferred time, and our reception will confirm it." },
        { q: "Where is the clinic?", a: "Please replace this answer with your address and a map link." },
      ],
    },
    templates: [
      T("appointment_reminder", "UTILITY", "Hello {{1}}, this is a reminder of your appointment on {{2}}. Reply here if you need to reschedule.", ["Asha", "Monday 10 AM"]),
      T("follow_up_visit", "UTILITY", "Hello {{1}}, it has been a while since your last visit. Reply here to book a follow-up with the doctor.", ["Asha"]),
    ],
  },
  {
    id: "salon",
    name: "Salon / Spa",
    description: "Booking confirmations, rebooking nudges and festive offers.",
    tags: [
      { name: "Regular", color: "emerald" },
      { name: "Bridal enquiry", color: "violet" },
      { name: "Membership", color: "sky" },
    ],
    agent: {
      name: "Salon assistant",
      instructions: "You answer for a salon. Be friendly and short. Share services and prices only from the knowledge base. For bookings collect name, service and preferred time and hand over to the team to confirm.",
      faqs: [
        { q: "What services do you offer?", a: "Please replace this answer with your service list." },
        { q: "What are your prices?", a: "Please replace this answer with your price list." },
        { q: "Do I need an appointment?", a: "Appointments are recommended. Tell us your preferred time and we will confirm." },
      ],
    },
    templates: [
      T("booking_confirmation", "UTILITY", "Hi {{1}}, your booking for {{2}} is confirmed. See you soon!", ["Neha", "Saturday 4 PM"]),
      T("rebook_nudge", "MARKETING", "Hi {{1}}, it is time for your next visit. Reply here and we will find a slot that suits you.", ["Neha"], "Reply STOP to opt out"),
    ],
  },
  {
    id: "real_estate",
    name: "Real estate",
    description: "Lead follow-up, site-visit scheduling and property enquiries.",
    tags: [
      { name: "Site visit", color: "emerald" },
      { name: "Budget confirmed", color: "amber" },
      { name: "Hot lead", color: "rose" },
    ],
    agent: {
      name: "Property assistant",
      instructions: "You answer for a real estate business. Qualify the lead: budget, preferred location and timeline. Never promise prices or availability that are not in the knowledge base. Offer to arrange a site visit and hand over to a sales executive.",
      faqs: [
        { q: "What projects do you have?", a: "Please replace this answer with your current projects." },
        { q: "Can I visit the site?", a: "Yes. Tell us your preferred day and time and our team will confirm the visit." },
        { q: "What is the price range?", a: "Please replace this answer with your price ranges." },
      ],
    },
    templates: [
      T("site_visit_reminder", "UTILITY", "Hello {{1}}, your site visit for {{2}} is scheduled for {{3}}. Reply here if you need to change the time.", ["Rahul", "Green Heights", "Sunday 11 AM"]),
      T("enquiry_followup", "UTILITY", "Hello {{1}}, thank you for your enquiry about {{2}}. Would you like to schedule a site visit?", ["Rahul", "Green Heights"]),
    ],
  },
  {
    id: "coaching",
    name: "Coaching / Education",
    description: "Admission enquiries, demo-class reminders and fee follow-ups.",
    tags: [
      { name: "Demo class", color: "emerald" },
      { name: "Admission open", color: "sky" },
      { name: "Fee pending", color: "amber" },
    ],
    agent: {
      name: "Admissions assistant",
      instructions: "You answer for a coaching institute. Share course details only from the knowledge base. Collect the student's name, class and course interest, and offer a demo class. Hand over fee negotiations to the team.",
      faqs: [
        { q: "Which courses do you offer?", a: "Please replace this answer with your course list." },
        { q: "What are the fees?", a: "Please replace this answer with your fee structure." },
        { q: "Can I attend a demo class?", a: "Yes. Tell us the course and your preferred day and we will confirm a demo class." },
      ],
    },
    templates: [
      T("demo_class_reminder", "UTILITY", "Hello {{1}}, your demo class for {{2}} is on {{3}}. We look forward to seeing you.", ["Simran", "Class 10 Maths", "Monday 5 PM"]),
      T("fee_reminder", "UTILITY", "Hello {{1}}, this is a reminder that the fee instalment of {{2}} is due on {{3}}.", ["Simran", "Rs 2,000", "10 November"]),
    ],
  },
];

export const packById = (id: string) => INDUSTRY_PACKS.find((p) => p.id === id);
