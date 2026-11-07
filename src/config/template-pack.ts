// Ready-to-adapt WhatsApp message templates (the free "template pack"). Variables are {{1}}, {{2}}... as Meta requires.
// Marketing templates must only go to people who opted in. Utility templates must be about something the customer did.
export type PackTemplate = { id: string; name: string; category: "UTILITY" | "MARKETING" | "AUTHENTICATION"; use: string; body: string };

export const TEMPLATE_PACK: PackTemplate[] = [
  { id: "order_confirmed", name: "order_confirmed", category: "UTILITY", use: "Right after an order", body: "Hello {{1}}, your order #{{2}} is confirmed ✅ We will update you when it is ready. Thank you for ordering with us." },
  { id: "order_out_for_delivery", name: "order_out_for_delivery", category: "UTILITY", use: "When delivery starts", body: "Hello {{1}}, your order #{{2}} is out for delivery. Expected by {{3}}." },
  { id: "order_delivered", name: "order_delivered", category: "UTILITY", use: "After delivery", body: "Hello {{1}}, your order #{{2}} has been delivered. If anything is wrong, just reply here and we will fix it." },
  { id: "appointment_confirmed", name: "appointment_confirmed", category: "UTILITY", use: "When a booking is made", body: "Hello {{1}}, your appointment on {{2}} at {{3}} is confirmed. Reply here if you need to reschedule." },
  { id: "appointment_reminder", name: "appointment_reminder", category: "UTILITY", use: "A day before", body: "Reminder: Hello {{1}}, you have an appointment tomorrow at {{2}}. Reply YES to confirm or tell us a new time." },
  { id: "appointment_rescheduled", name: "appointment_rescheduled", category: "UTILITY", use: "When a time changes", body: "Hello {{1}}, your appointment has been moved to {{2}} at {{3}}. Reply here if this does not suit you." },
  { id: "payment_received", name: "payment_received", category: "UTILITY", use: "After a payment", body: "Hello {{1}}, we received your payment of ₹{{2}} for {{3}}. Thank you!" },
  { id: "payment_due_reminder", name: "payment_due_reminder", category: "UTILITY", use: "Before a due date", body: "Hello {{1}}, a gentle reminder that ₹{{2}} for {{3}} is due on {{4}}. Reply here if you need help." },
  { id: "invoice_ready", name: "invoice_ready", category: "UTILITY", use: "When an invoice is created", body: "Hello {{1}}, your invoice #{{2}} for ₹{{3}} is ready. Please pay by {{4}}." },
  { id: "booking_received", name: "booking_received", category: "UTILITY", use: "Hotel or travel enquiry", body: "Hello {{1}}, we received your request for {{2}} on {{3}}. Our team will confirm availability shortly." },
  { id: "membership_renewal", name: "membership_renewal", category: "UTILITY", use: "Gyms, clubs, courses", body: "Hello {{1}}, your membership ends on {{2}}. Reply here to renew and keep your benefits." },
  { id: "class_reminder", name: "class_reminder", category: "UTILITY", use: "Coaching and classes", body: "Hello {{1}}, today's class {{2}} starts at {{3}}. See you there!" },
  { id: "feedback_request", name: "feedback_request", category: "UTILITY", use: "After a visit or purchase", body: "Hello {{1}}, thank you for visiting {{2}}. How was your experience? Reply with a number from 1 (poor) to 5 (excellent)." },
  { id: "support_ticket_update", name: "support_ticket_update", category: "UTILITY", use: "Support follow-up", body: "Hello {{1}}, your request #{{2}} is now {{3}}. Reply here if you have questions." },
  { id: "otp_code", name: "otp_code", category: "AUTHENTICATION", use: "Login or verification", body: "{{1}} is your verification code. Do not share it with anyone." },
  { id: "festival_offer", name: "festival_offer", category: "MARKETING", use: "Festivals (opted-in customers only)", body: "Happy {{1}} from {{2}}! 🎉 Enjoy {{3}} until {{4}}. Reply here to order or book." },
  { id: "new_arrival", name: "new_arrival", category: "MARKETING", use: "Shops and boutiques", body: "Hello {{1}}, new arrivals are in at {{2}}! Reply YES to get the catalogue on WhatsApp." },
  { id: "weekend_offer", name: "weekend_offer", category: "MARKETING", use: "Restaurants, salons, spas", body: "Hello {{1}}, this weekend only: {{2}} at {{3}}. Reply here to book your slot." },
  { id: "win_back", name: "win_back", category: "MARKETING", use: "Customers who have not visited in a while", body: "Hello {{1}}, we have missed you at {{2}}! Here is {{3}} on your next visit. Valid till {{4}}." },
  { id: "event_invite", name: "event_invite", category: "MARKETING", use: "Workshops, demo classes, launches", body: "Hello {{1}}, you are invited to {{2}} on {{3}} at {{4}}. Reply YES to reserve your seat." },
  { id: "referral_ask", name: "referral_ask", category: "MARKETING", use: "Happy customers", body: "Hello {{1}}, thank you for choosing {{2}}! Know someone who would love us? Share this chat and they get {{3}}." },
  { id: "abandoned_enquiry", name: "abandoned_enquiry", category: "MARKETING", use: "Followed up once, politely", body: "Hello {{1}}, you asked us about {{2}} earlier. Would you like us to share the details again? Reply YES." },
];

export const PACK_RULES = [
  "Send marketing messages only to people who agreed to receive them (opt-in), and always make it easy to say STOP.",
  "Utility templates must be about something the customer already did (an order, a booking, a payment). Don't put promotions in them: Meta re-categorises such templates as marketing and can restrict numbers that misuse categories.",
  "Templates must be approved by Meta before you can send them. Replace the {{1}}, {{2}} variables with real data when sending, and keep the wording close to what you submit.",
  "Replies within 24 hours of a customer's message don't need a template.",
];

export const PACK_PDF = "/downloads/mecgura-whatsapp-message-templates.pdf";
