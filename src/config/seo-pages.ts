// Content for the industry and city pages on mecgura.tech. Everything claimed here is something the platform really does.
// Sample chats are illustrative examples, labelled as such on the page. No client names or results are invented.

export type Chat = { from: "customer" | "business"; text: string };
export type Industry = {
  slug: string;
  name: string; // "Salon & beauty"
  who: string; // "salons, spas and beauty studios"
  headline: string;
  intro: string;
  problems: { problem: string; fix: string }[];
  chat: Chat[];
  setup: string[];
  faqs: { q: string; a: string }[];
};

export const INDUSTRIES: Industry[] = [
  {
    slug: "salon",
    name: "Salon & beauty",
    who: "salons, spas, makeup artists and beauty studios",
    headline: "WhatsApp automation for salons and beauty studios",
    intro: "Clients ask for prices, offers and slots on WhatsApp all day, often while you are busy with a customer. MECGURA replies instantly, shares your service list, and books the slot, so no enquiry goes cold.",
    problems: [
      { problem: "Enquiries come while you are with a client and get answered hours later.", fix: "An instant reply with your service menu and buttons for price list, booking and offers." },
      { problem: "Slots are booked on calls and messages and double-booked.", fix: "A booking flow that asks service, day and time, saves it on the contact and hands the chat to your team." },
      { problem: "Clients forget their appointment.", fix: "Appointment reminders as approved utility templates." },
      { problem: "Regulars drift away.", fix: "Festival and bridal-season offers sent only to clients who agreed to receive them." },
    ],
    chat: [
      { from: "customer", text: "Hi, bridal makeup price?" },
      { from: "business", text: "Namaste! Thanks for contacting us 🙏 Tap an option below." },
      { from: "business", text: "Price list · Book appointment · Talk to team" },
      { from: "customer", text: "Book appointment" },
      { from: "business", text: "Which service is it for, and which day suits you?" },
    ],
    setup: ["Instant welcome reply with your service price list and brochure", "Appointment booking flow (service, day, time) and team assignment", "Reminder and follow-up templates for approval", "Offers to opted-in clients, with an easy STOP", "Google review requests after a visit"],
    faqs: [
      { q: "Can clients book directly on WhatsApp?", a: "Yes. The booking flow collects service, day and time and your team confirms the exact slot in the same chat." },
      { q: "Will it replace my receptionist?", a: "No. It answers repeat questions instantly and hands real conversations to your team." },
      { q: "Do I need a new number?", a: "Usually not. Setup is normally done on your existing business number." },
    ],
  },
  {
    slug: "restaurant",
    name: "Restaurants & cafes",
    who: "restaurants, cafes, bakeries and cloud kitchens",
    headline: "WhatsApp automation for restaurants and cafes",
    intro: "Customers want the menu, timings and a table or order in one tap. MECGURA answers instantly, shares your menu, and can take orders from a QR code with a kitchen screen for your staff.",
    problems: [
      { problem: "The same questions (menu, timings, location) every day.", fix: "Instant replies with the menu, timings and a map link." },
      { problem: "Orders arrive as messy chats.", fix: "A QR menu: the guest picks items, confirms on WhatsApp, and the kitchen screen shows the order." },
      { problem: "Guests don't know when the food is ready.", fix: "A WhatsApp update when the order is accepted, being prepared, ready and delivered." },
      { problem: "Quiet weekdays.", fix: "Offers to customers who opted in, timed to your slow hours." },
    ],
    chat: [
      { from: "customer", text: "Menu?" },
      { from: "business", text: "Hi! 🍽️ Here is our menu. Tap to order, see timings or talk to us." },
      { from: "customer", text: "Order" },
      { from: "business", text: "Great! Open the menu, pick your items and confirm here on WhatsApp." },
    ],
    setup: ["Instant menu, timings and location replies", "QR menu for tables with orders confirmed on WhatsApp", "Kitchen screen with live status updates to the guest", "Pay now, or pay at the counter", "Offers to opted-in customers"],
    faqs: [
      { q: "Do guests need to install an app?", a: "No. They scan a QR, pick items on a web page and confirm on WhatsApp." },
      { q: "How is payment handled?", a: "You can offer pay-now through your own Razorpay account, or pay at the counter. Money goes straight to you." },
      { q: "Does it work for delivery orders?", a: "The WhatsApp replies and menu work for delivery enquiries. QR ordering is built for tables." },
    ],
  },
  {
    slug: "resort",
    name: "Hotels, resorts & homestays",
    who: "hotels, resorts, homestays and travel desks",
    headline: "WhatsApp automation for hotels, resorts and homestays",
    intro: "Guests ask about rooms, rates and availability before they book, and order food and services after they arrive. MECGURA answers enquiries instantly and gives in-room guests a QR for food ordering, with updates from the kitchen.",
    problems: [
      { problem: "Enquiries come at night and are answered next day.", fix: "An instant reply with rooms, photos, a brochure and a button to talk to reservations." },
      { problem: "Rate and availability questions repeat.", fix: "A price-list reply with your room categories and a hand-over to your team for dates." },
      { problem: "Room service orders are taken over calls.", fix: "A QR in each room: the guest orders, the kitchen sees it, and the guest gets status updates. Charge to the room bill or pay now." },
      { problem: "No feedback while the guest is still there.", fix: "A short rating request that alerts you to unhappy guests." },
    ],
    chat: [
      { from: "customer", text: "Room rates for 2 nights?" },
      { from: "business", text: "Welcome 🙏 Here are our rooms and brochure." },
      { from: "business", text: "Room rates · Check availability · Talk to reservations" },
      { from: "customer", text: "Check availability" },
      { from: "business", text: "Please share your dates and number of guests. Our team will confirm shortly." },
    ],
    setup: ["Instant enquiry reply with room photos and a PDF brochure", "Reservation hand-over with team assignment", "In-room QR food ordering with a kitchen screen and room-bill option", "Guest feedback with alerts for low ratings", "Offers for repeat guests who opted in"],
    faqs: [
      { q: "Can it post charges to the room bill?", a: "Orders can be marked as room bill so reception adds them at check-out. Pay-now and pay-at-counter are also available." },
      { q: "Does it take bookings automatically?", a: "It collects the enquiry and hands it to reservations. Your team confirms availability and rates." },
      { q: "Can it handle Hindi, Punjabi and English?", a: "Messages can be written in Hinglish or any language you like. Customers who ask for Hindi or Punjabi can be handed to your team." },
    ],
  },
  {
    slug: "coaching",
    name: "Coaching & education",
    who: "coaching institutes, tuition centres, skill academies and schools",
    headline: "WhatsApp automation for coaching institutes and academies",
    intro: "Parents and students ask about fees, batches and demo classes. MECGURA answers instantly, qualifies the enquiry (course, city, timing) and hands warm leads to your counsellors.",
    problems: [
      { problem: "Admission enquiries get lost between calls and chats.", fix: "Every enquiry is saved as a lead with name, course and timing, and assigned to a counsellor." },
      { problem: "Counsellors repeat fee and batch details all day.", fix: "An instant reply with batches, fees (your numbers) and brochure." },
      { problem: "Leads go cold after the first call.", fix: "Follow-up reminders to your team, and a message series for people who haven't decided." },
      { problem: "Parents need updates.", fix: "Class, test and fee reminders as approved utility templates." },
    ],
    chat: [
      { from: "customer", text: "NEET batch fees?" },
      { from: "business", text: "Hello! 🙏 We have a few quick questions so the right counsellor can help you." },
      { from: "business", text: "Which class is the student in?" },
      { from: "customer", text: "Class 11" },
      { from: "business", text: "Thanks. Here is our brochure. Our counsellor will call you today." },
    ],
    setup: ["Instant reply with batches, brochure and fee details", "Lead qualification (name, city, course, timeline)", "Hot leads tagged and assigned to counsellors", "Fee, class and test reminders via templates", "Demo class and event announcements to opted-in contacts"],
    faqs: [
      { q: "Can it send fee reminders?", a: "Yes, as approved utility templates to students or parents who gave their number for updates." },
      { q: "How are leads shown to counsellors?", a: "In the shared inbox and the CRM, with tags like Hot lead, so counsellors know whom to call first." },
      { q: "Is there a limit on contacts?", a: "Each plan has a contact and message limit. See the pricing on the homepage." },
    ],
  },
  {
    slug: "clinic",
    name: "Clinics & doctors",
    who: "clinics, dental practices, physiotherapy centres and diagnostic labs",
    headline: "WhatsApp automation for clinics and doctors",
    intro: "Patients want timings, a slot and a reminder. MECGURA replies instantly, collects appointment requests and sends reminders. It never gives medical advice: symptoms and emergencies go to your team.",
    problems: [
      { problem: "Reception is flooded with timing and appointment calls.", fix: "Instant replies with timings, location and doctors, and an appointment request flow." },
      { problem: "Patients miss appointments.", fix: "Appointment reminders as approved utility templates." },
      { problem: "Follow-ups are forgotten.", fix: "Follow-up messages to patients who agreed to receive them." },
      { problem: "You need to stay careful about medical advice.", fix: "Replies are set by you. The assistant is configured not to diagnose, and hands over to your staff." },
    ],
    chat: [
      { from: "customer", text: "Dr. Sharma timing?" },
      { from: "business", text: "Hello 🙏 Dr. Sharma sits Mon-Sat, 10 AM-2 PM. Would you like to request an appointment?" },
      { from: "customer", text: "Yes, tomorrow" },
      { from: "business", text: "Please share the patient's name. Reception will confirm the exact time." },
    ],
    setup: ["Timings, location and doctor information replies", "Appointment request flow with reception hand-over", "Reminder and follow-up templates for approval", "Safe assistant rules: no diagnosis, hand over to staff", "Feedback and review requests"],
    faqs: [
      { q: "Does it give medical advice?", a: "No. It is set up to answer only what you approve and to hand symptoms and emergencies to your staff." },
      { q: "Is patient data safe?", a: "Chats are stored in your workspace with role-based access. Read our privacy policy for details." },
      { q: "Can patients cancel or reschedule?", a: "They can message to reschedule and your reception handles it in the same chat." },
    ],
  },
  {
    slug: "real-estate",
    name: "Real estate",
    who: "builders, brokers, property dealers and developers",
    headline: "WhatsApp automation for real estate and property dealers",
    intro: "Property enquiries from ads and portals need a reply in minutes. MECGURA answers instantly, asks budget and location, shares brochures and photos, and assigns serious buyers to your sales team.",
    problems: [
      { problem: "Ad leads go cold within hours.", fix: "An instant reply with the project brochure and a short qualification (budget, location, timeline)." },
      { problem: "Brokers waste time on casual enquiries.", fix: "Hot leads are tagged and assigned, casual ones get a follow-up message." },
      { problem: "Site visit scheduling is messy.", fix: "A site-visit request flow with day and time, handed to your team." },
      { problem: "Old leads are forgotten.", fix: "Follow-ups and new-launch updates to contacts who opted in." },
    ],
    chat: [
      { from: "customer", text: "2BHK price?" },
      { from: "business", text: "Hello 🙏 Thanks for your interest. Here is the brochure." },
      { from: "business", text: "What is your budget range?" },
      { from: "customer", text: "50-70 lakh" },
      { from: "business", text: "Thanks! Our sales manager will call you today about site visit options." },
    ],
    setup: ["Instant reply with brochure and project photos", "Qualification: budget, location, timeline", "Hot-lead tagging and assignment to sales", "Site-visit request flow", "Follow-ups and launch updates to opted-in contacts"],
    faqs: [
      { q: "Can it work with my Facebook / Google ads?", a: "Yes. Click-to-WhatsApp ad leads can start a dedicated flow, so each ad gets its own conversation." },
      { q: "Will it call leads?", a: "It starts the conversation and assigns leads. Your team makes the calls." },
      { q: "Can I send brochures and videos?", a: "Yes. Images and PDF brochures can be attached to messages." },
    ],
  },
  {
    slug: "retail",
    name: "Retail & kirana shops",
    who: "shops, showrooms, boutiques, pharmacies and kirana stores",
    headline: "WhatsApp automation for shops, showrooms and kirana stores",
    intro: "Customers message to ask if an item is in stock, what the price is and whether you deliver. MECGURA answers instantly, shares your catalogue or price list, and lets you send offers to customers who agreed to receive them.",
    problems: [
      { problem: "Repeated questions about price, stock and delivery.", fix: "Instant replies with your price list, timings and delivery information." },
      { problem: "Customers forget about you between visits.", fix: "Festival and offer messages to customers who opted in." },
      { problem: "No record of who your customers are.", fix: "Every chat becomes a contact with tags, in a simple CRM." },
      { problem: "Online orders are messy.", fix: "A product enquiry flow that collects what the customer wants and hands it to your team." },
    ],
    chat: [
      { from: "customer", text: "Is the 5-litre oil available?" },
      { from: "business", text: "Namaste! 🙏 Tap an option: Price list · Delivery · Talk to us" },
      { from: "customer", text: "Delivery" },
      { from: "business", text: "We deliver within 5 km, same day for orders before 4 PM." },
    ],
    setup: ["Instant replies with price list and delivery details", "Product enquiry flow with team hand-over", "Contact list with tags for regular customers", "Festival offers to opted-in customers", "Loyalty points for repeat purchases"],
    faqs: [
      { q: "Can I show my catalogue?", a: "You can share a price list, images and a PDF brochure in replies." },
      { q: "Can I send offers to everyone in my phone?", a: "Only to customers who agreed to receive them. This protects your number from being restricted by WhatsApp." },
      { q: "Is it hard to set up?", a: "Our team sets it up, usually in about a day on your existing number." },
    ],
  },
  {
    slug: "gym",
    name: "Gyms & fitness",
    who: "gyms, yoga studios, Zumba and fitness trainers",
    headline: "WhatsApp automation for gyms and fitness studios",
    intro: "Walk-in enquiries and membership questions come on WhatsApp at all hours. MECGURA replies instantly with plans and timings, books trial sessions, and reminds members when their membership is due.",
    problems: [
      { problem: "Enquiries asking for fees and timings.", fix: "Instant replies with membership plans, timings and a trial-session button." },
      { problem: "Trial visits are not followed up.", fix: "A follow-up message after the trial, and a reminder to your team." },
      { problem: "Members lapse silently.", fix: "Renewal reminders as approved utility templates." },
      { problem: "Slow months.", fix: "Offers to past members who agreed to receive them." },
    ],
    chat: [
      { from: "customer", text: "Monthly fee?" },
      { from: "business", text: "Hi! 💪 Tap an option: Plans · Free trial · Timings" },
      { from: "customer", text: "Free trial" },
      { from: "business", text: "Great! Which day and time suits you for the trial session?" },
    ],
    setup: ["Instant reply with plans, timings and location", "Trial session booking flow", "Renewal and due-date reminders via templates", "Follow-ups after trial visits", "Offers to past members who opted in"],
    faqs: [
      { q: "Can it send membership renewal reminders?", a: "Yes, as approved utility templates to members who gave their number for updates." },
      { q: "Can we track enquiries?", a: "Every enquiry is saved as a contact and lead with tags, so staff know whom to call." },
      { q: "Does the number have to change?", a: "Usually not. Setup is normally done on your existing business number." },
    ],
  },
];

export type City = { slug: string; name: string; region: string; intro: string; businesses: string[] };
export const CITIES: City[] = [
  { slug: "ludhiana", name: "Ludhiana", region: "Punjab", intro: "Ludhiana is one of Punjab's biggest business cities, with a very large base of shops, manufacturers, coaching centres and clinics that get customer enquiries on WhatsApp all day.", businesses: ["Manufacturers and traders", "Boutiques and retail showrooms", "Coaching and skill institutes", "Clinics and diagnostic labs", "Real estate and property dealers"] },
  { slug: "shimla", name: "Shimla", region: "Himachal Pradesh", intro: "In Shimla and across Himachal, hotels, homestays, cafes and travel desks win or lose bookings by how fast they answer a tourist's message.", businesses: ["Hotels, resorts and homestays", "Cafes and restaurants", "Travel and taxi desks", "Handicraft and retail shops", "Coaching and tuition centres"] },
  { slug: "chandigarh", name: "Chandigarh", region: "Chandigarh & Tricity", intro: "Chandigarh, Mohali and Panchkula have many clinics, coaching institutes, salons and property dealers that compete on response time.", businesses: ["Clinics and dental practices", "Coaching and immigration consultants", "Salons and wellness studios", "Real estate and builders", "Cafes and restaurants"] },
  { slug: "amritsar", name: "Amritsar", region: "Punjab", intro: "Amritsar's tourism, food and hospitality businesses get enquiries from visitors across India and abroad, often outside working hours.", businesses: ["Hotels and guest houses", "Restaurants and sweet shops", "Travel agents and tour operators", "Textile and retail shops", "Clinics and hospitals"] },
  { slug: "jalandhar", name: "Jalandhar", region: "Punjab", intro: "Jalandhar's sports goods, manufacturing and retail businesses, plus its coaching and clinic sector, deal with a steady flow of price and order enquiries.", businesses: ["Sports goods and manufacturing", "Retail and wholesale shops", "Coaching and immigration offices", "Clinics and gyms", "Real estate dealers"] },
];

export const industryBySlug = (s: string) => INDUSTRIES.find((i) => i.slug === s);
export const cityBySlug = (s: string) => CITIES.find((c) => c.slug === s);
