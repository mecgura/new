import type { EventType, Language } from "./catalog";

/**
 * Built-in message texts. They are short, carry NO diagnoses, results or prescription contents, and point to the secure patient portal.
 * A clinic overrides any of them with its own template; WhatsApp can only send a clinic template that has an APPROVED provider template name.
 */
interface Text { subject: string; text: string }
const en: Record<EventType, Text> = {
  APPOINTMENT_REQUESTED: { subject: "We received your appointment request", text: "Dear {{patient_name}}, {{clinic_name}} has received your appointment request for {{appointment_date}} at {{appointment_time}}. It is not confirmed until the clinic confirms it. Details: {{portal_link}}" },
  APPOINTMENT_CONFIRMED: { subject: "Your appointment is confirmed", text: "Dear {{patient_name}}, your appointment with {{doctor_name}} at {{clinic_name}} is confirmed for {{appointment_date}} at {{appointment_time}}. Details: {{portal_link}}" },
  APPOINTMENT_RESCHEDULED: { subject: "Your appointment time has changed", text: "Dear {{patient_name}}, your appointment at {{clinic_name}} is now on {{appointment_date}} at {{appointment_time}} with {{doctor_name}}. Details: {{portal_link}}" },
  APPOINTMENT_CANCELLED: { subject: "Your appointment was cancelled", text: "Dear {{patient_name}}, your appointment at {{clinic_name}} on {{appointment_date}} at {{appointment_time}} has been cancelled. To book again, call {{clinic_phone}}." },
  APPOINTMENT_REMINDER: { subject: "Appointment reminder", text: "Dear {{patient_name}}, a reminder of your appointment with {{doctor_name}} at {{clinic_name}} on {{appointment_date}} at {{appointment_time}}. Details: {{portal_link}}" },
  OPD_CHECKED_IN: { subject: "Your token number", text: "Dear {{patient_name}}, you are registered at {{clinic_name}}. Your token number is {{token_number}}. Please stay nearby." },
  OPD_CALLED: { subject: "It is your turn", text: "Dear {{patient_name}}, token {{token_number}} has been called at {{clinic_name}}. Please go to the consultation room." },
  PRESCRIPTION_AVAILABLE: { subject: "Your prescription is available", text: "Dear {{patient_name}}, your prescription from {{clinic_name}} is now available in your secure patient portal. View it here: {{portal_link}}" },
  LAB_REPORT_RELEASED: { subject: "Your lab report is available", text: "Dear {{patient_name}}, your lab report from {{clinic_name}} is now available in your secure patient portal. View it here: {{portal_link}}" },
  FOLLOW_UP_CREATED: { subject: "A follow-up has been planned", text: "Dear {{patient_name}}, {{clinic_name}} has planned a follow-up for you around {{follow_up_date}}. Details: {{portal_link}}" },
  FOLLOW_UP_REMINDER: { subject: "Follow-up reminder", text: "Dear {{patient_name}}, a reminder from {{clinic_name}} that your follow-up is due on {{follow_up_date}}. Book or check details: {{portal_link}}" },
  FOLLOW_UP_OVERDUE: { subject: "Your follow-up is pending", text: "Dear {{patient_name}}, your follow-up at {{clinic_name}} (due {{follow_up_date}}) is still pending. Please book a visit: {{portal_link}}" },
  INVOICE_CREATED: { subject: "A new bill from your clinic", text: "Dear {{patient_name}}, a bill {{invoice_number}} has been issued by {{clinic_name}}. You can view it in your secure patient portal: {{portal_link}}" },
  INVOICE_DUE: { subject: "Your bill is due", text: "Dear {{patient_name}}, bill {{invoice_number}} from {{clinic_name}} is due. Amount due: {{amount_due}}. View it in your secure patient portal: {{portal_link}}" },
  INVOICE_OVERDUE: { subject: "Your bill is overdue", text: "Dear {{patient_name}}, bill {{invoice_number}} from {{clinic_name}} is past its due date. Amount due: {{amount_due}}. View it in your secure patient portal: {{portal_link}}" },
  PAYMENT_SUCCESS: { subject: "Payment received", text: "Dear {{patient_name}}, we have received your payment of {{amount_paid}} on {{payment_date}} at {{clinic_name}}. Your receipt {{receipt_number}} is in your patient portal: {{portal_link}}" },
  PATIENT_ACCOUNT_ACTIVATED: { subject: "Your patient portal is ready", text: "Dear {{patient_name}}, your {{clinic_name}} patient portal account is now active. If this was not you, call {{clinic_phone}} immediately." },
  ACCOUNT_SECURITY_ALERT: { subject: "Security alert for your patient portal", text: "Dear {{patient_name}}, {{security_event}} on your {{clinic_name}} patient portal account. If this was not you, call {{clinic_phone}} immediately." },
  CLINIC_ANNOUNCEMENT: { subject: "A message from your clinic", text: "Dear {{patient_name}}, {{clinic_name}} has an update for you. Details: {{portal_link}}" },
};

const hi: Partial<Record<EventType, Text>> = {
  APPOINTMENT_CONFIRMED: { subject: "आपकी अपॉइंटमेंट पक्की हो गई है", text: "प्रिय {{patient_name}}, {{clinic_name}} में {{doctor_name}} के साथ आपकी अपॉइंटमेंट {{appointment_date}} को {{appointment_time}} बजे के लिए पक्की हो गई है। विवरण: {{portal_link}}" },
  APPOINTMENT_RESCHEDULED: { subject: "आपकी अपॉइंटमेंट का समय बदल गया है", text: "प्रिय {{patient_name}}, {{clinic_name}} में आपकी अपॉइंटमेंट का नया समय {{appointment_date}}, {{appointment_time}} है ({{doctor_name}})। विवरण: {{portal_link}}" },
  APPOINTMENT_CANCELLED: { subject: "आपकी अपॉइंटमेंट रद्द कर दी गई है", text: "प्रिय {{patient_name}}, {{clinic_name}} में {{appointment_date}} को {{appointment_time}} बजे की आपकी अपॉइंटमेंट रद्द कर दी गई है। नई अपॉइंटमेंट के लिए संपर्क करें: {{clinic_phone}}" },
  APPOINTMENT_REMINDER: { subject: "अपॉइंटमेंट की याद", text: "प्रिय {{patient_name}}, याद दिलाना: {{clinic_name}} में {{doctor_name}} के साथ आपकी अपॉइंटमेंट {{appointment_date}} को {{appointment_time}} बजे है। विवरण: {{portal_link}}" },
  PRESCRIPTION_AVAILABLE: { subject: "आपका प्रिस्क्रिप्शन उपलब्ध है", text: "प्रिय {{patient_name}}, आपका प्रिस्क्रिप्शन अब आपके सुरक्षित पेशेंट पोर्टल में उपलब्ध है। देखें: {{portal_link}}" },
  LAB_REPORT_RELEASED: { subject: "आपकी लैब रिपोर्ट उपलब्ध है", text: "प्रिय {{patient_name}}, आपकी लैब रिपोर्ट अब आपके सुरक्षित पेशेंट पोर्टल में उपलब्ध है। देखें: {{portal_link}}" },
  FOLLOW_UP_REMINDER: { subject: "फॉलो-अप की याद", text: "प्रिय {{patient_name}}, {{clinic_name}} की ओर से याद दिलाना: आपका फॉलो-अप {{follow_up_date}} को है। विवरण: {{portal_link}}" },
};
const pa: Partial<Record<EventType, Text>> = {
  APPOINTMENT_CONFIRMED: { subject: "ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਪੱਕੀ ਹੋ ਗਈ ਹੈ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, {{clinic_name}} ਵਿੱਚ {{doctor_name}} ਨਾਲ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ {{appointment_date}} ਨੂੰ {{appointment_time}} ਵਜੇ ਲਈ ਪੱਕੀ ਹੋ ਗਈ ਹੈ। ਵੇਰਵਾ: {{portal_link}}" },
  APPOINTMENT_RESCHEDULED: { subject: "ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਦਾ ਸਮਾਂ ਬਦਲ ਗਿਆ ਹੈ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, {{clinic_name}} ਵਿੱਚ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਦਾ ਨਵਾਂ ਸਮਾਂ {{appointment_date}}, {{appointment_time}} ਹੈ ({{doctor_name}})। ਵੇਰਵਾ: {{portal_link}}" },
  APPOINTMENT_CANCELLED: { subject: "ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਰੱਦ ਕਰ ਦਿੱਤੀ ਗਈ ਹੈ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, {{clinic_name}} ਵਿੱਚ {{appointment_date}} ਨੂੰ {{appointment_time}} ਵਜੇ ਦੀ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਰੱਦ ਕਰ ਦਿੱਤੀ ਗਈ ਹੈ। ਨਵੀਂ ਅਪਾਇੰਟਮੈਂਟ ਲਈ ਸੰਪਰਕ ਕਰੋ: {{clinic_phone}}" },
  APPOINTMENT_REMINDER: { subject: "ਅਪਾਇੰਟਮੈਂਟ ਦੀ ਯਾਦ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, ਯਾਦ ਦਿਵਾਉਣਾ: {{clinic_name}} ਵਿੱਚ {{doctor_name}} ਨਾਲ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ {{appointment_date}} ਨੂੰ {{appointment_time}} ਵਜੇ ਹੈ। ਵੇਰਵਾ: {{portal_link}}" },
  PRESCRIPTION_AVAILABLE: { subject: "ਤੁਹਾਡਾ ਪ੍ਰਿਸਕ੍ਰਿਪਸ਼ਨ ਉਪਲਬਧ ਹੈ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, ਤੁਹਾਡਾ ਪ੍ਰਿਸਕ੍ਰਿਪਸ਼ਨ ਹੁਣ ਤੁਹਾਡੇ ਸੁਰੱਖਿਅਤ ਪੇਸ਼ੈਂਟ ਪੋਰਟਲ ਵਿੱਚ ਉਪਲਬਧ ਹੈ। ਵੇਖੋ: {{portal_link}}" },
  LAB_REPORT_RELEASED: { subject: "ਤੁਹਾਡੀ ਲੈਬ ਰਿਪੋਰਟ ਉਪਲਬਧ ਹੈ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, ਤੁਹਾਡੀ ਲੈਬ ਰਿਪੋਰਟ ਹੁਣ ਤੁਹਾਡੇ ਸੁਰੱਖਿਅਤ ਪੇਸ਼ੈਂਟ ਪੋਰਟਲ ਵਿੱਚ ਉਪਲਬਧ ਹੈ। ਵੇਖੋ: {{portal_link}}" },
  FOLLOW_UP_REMINDER: { subject: "ਫਾਲੋ-ਅੱਪ ਦੀ ਯਾਦ", text: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {{patient_name}}, {{clinic_name}} ਵੱਲੋਂ ਯਾਦ ਦਿਵਾਉਣਾ: ਤੁਹਾਡਾ ਫਾਲੋ-ਅੱਪ {{follow_up_date}} ਨੂੰ ਹੈ। ਵੇਰਵਾ: {{portal_link}}" },
};

const TABLE: Record<Language, Partial<Record<EventType, Text>>> = { en, hi, pa };
export function builtinText(event: EventType, language: Language): (Text & { language: Language }) | null {
  const t = TABLE[language]?.[event]; return t ? { ...t, language } : null;
}
export const builtinLanguages = (event: EventType): Language[] => (["en", "hi", "pa"] as Language[]).filter((l) => !!TABLE[l][event]);
