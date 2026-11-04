/**
 * Starter articles for mecgura.tech/blog, published once by the seed (marker "migration:blog_starters_2026_11").
 * Facts are kept general and current as of Nov 2026; anything that changes often (Meta's per-message rates,
 * limits) points readers to the official source instead of quoting a number.
 */
export const BLOG_STARTERS: { slug: string; title: string; excerpt: string; tags: string; body: string }[] = [
  {
    slug: "whatsapp-business-api-pricing-india",
    title: "WhatsApp Business API pricing in India: what you actually pay in 2026",
    excerpt: "The two bills behind WhatsApp Business API in India — Meta's per-message charges and the platform fee — and how to compare providers without surprises.",
    tags: "WhatsApp API, Pricing, India",
    body: `If you are planning to use WhatsApp Business API in India, the price you see on a provider's website is usually only half the story. There are **two separate costs**, and knowing both saves you from surprises at the end of the month.

## The two parts of the bill

1. **Meta's message charges** — what Meta (WhatsApp's parent company) charges for certain messages your business sends.
2. **The platform fee** — what the software provider charges for the inbox, campaigns, chatbots, CRM and support.

Some providers bundle these together, some add a margin on top of Meta's charges, and some let Meta bill you directly. Always ask which model you are on.

## How Meta charges for messages

Meta charges for **template messages** — pre-approved messages a business sends first, such as offers, order updates or OTPs. Templates fall into three categories:

- **Marketing** — offers, festival greetings, new arrivals, re-engagement. These cost the most.
- **Utility** — order confirmations, delivery updates, appointment reminders, payment receipts.
- **Authentication** — one-time passwords (OTPs) for login or verification.

When a customer messages you, a **24-hour customer service window** opens. Replies you send inside that window are free, and utility templates sent inside an open window are also free. This is why getting customers to message you first (for example through Click-to-WhatsApp ads or a QR code at your counter) keeps costs low.

Meta's rates differ by country and change from time to time, so always check the current rate card on Meta's official [WhatsApp Business pricing page](https://developers.facebook.com/docs/whatsapp/pricing) instead of relying on old blog numbers.

## What platform fees look like in India

Most Indian WhatsApp platforms charge a monthly subscription. In late 2026, entry plans of popular providers start roughly between ₹1,500 and ₹3,000 a month, with mid-tier plans around ₹3,500–₹7,000 and higher tiers above that. What changes between plans is usually:

- number of team members (agent logins),
- number of WhatsApp numbers,
- automation and chatbot limits,
- AI features, API access and integrations,
- support level.

## Hidden costs to check before you sign

- **Markup on Meta's charges.** Ask whether message charges are passed through at Meta's rate or with a margin.
- **Extra agents.** Some plans include very few logins and charge per extra user.
- **AI and chatbot add-ons.** AI replies are often a separate paid add-on.
- **Annual lock-in.** Yearly plans are cheaper per month but check the refund policy.
- **GST.** Indian prices are usually shown before 18% GST.

## A simple way to estimate your monthly cost

> Platform fee + (marketing messages × marketing rate) + (utility messages outside the 24-hour window × utility rate) + GST

For most small businesses, the biggest lever is the number of marketing messages. Sending fewer, better-targeted campaigns to people who actually opted in usually costs less **and** gets more replies.

## How MECGURA handles pricing

MECGURA shows its plan prices openly in the [pricing section](/#pricing), with a yearly option and a free trial on most plans. Meta's message charges are billed by Meta to your WhatsApp Business account, or — if you prefer — through a prepaid wallet where the per-message service fee is shown before you top up. Either way you see what you pay for before you pay it.

If you are unsure which plan fits, message us on WhatsApp with your expected number of customers and campaigns, and we will estimate the monthly cost with you.`,
  },
  {
    slug: "whatsapp-business-app-vs-api",
    title: "WhatsApp Business App vs WhatsApp Business API: which one does your business need?",
    excerpt: "Free WhatsApp Business App or the paid API? A plain comparison for Indian businesses — team size, automation, broadcasts and when it's time to upgrade.",
    tags: "WhatsApp API, WhatsApp Business App, Guide",
    body: `Almost every business in India starts with the free **WhatsApp Business App**. At some point, chats pile up, staff share one phone, and broadcasts stop reaching people. That is usually when owners start asking about the **WhatsApp Business API**. Here is a clear comparison to help you decide.

## WhatsApp Business App: great for getting started

The app is free and runs on your phone. It gives you a business profile, a catalogue, quick replies, labels, greeting and away messages.

It works well when:

- one or two people handle all chats,
- you get a manageable number of messages a day,
- most customers already have your number saved.

Its limits show up as you grow: everyone has to work from linked devices of one account, there is no proper assignment of chats to staff, automation is basic, and broadcast lists only reach people who have saved your number.

## WhatsApp Business API: built for teams and automation

The API (Meta's Cloud API) is used through a platform like MECGURA. It is designed for businesses that need:

- **A shared team inbox** — many staff reply from their own logins, and chats can be assigned.
- **Automation** — instant replies, menus, lead questions, appointment booking and follow-ups.
- **Campaigns to opted-in customers** — using Meta-approved templates, with delivery and read reports.
- **AI replies** — answers from your own FAQs, price list and documents.
- **Integrations** — CRM, website forms, online stores and other tools.

The trade-off: the API is paid (a platform fee plus Meta's per-message charges for template messages), and messages you send first must use approved templates.

## Side-by-side

- **Cost:** App is free · API has a platform fee + Meta charges
- **Users:** App is one account on linked devices · API gives separate logins for each team member
- **Automation:** App has greeting/away messages · API has full chatbots and workflows
- **Bulk messaging:** App broadcast lists only reach people who saved your number · API campaigns reach opted-in contacts with templates
- **Reports:** App has basic statistics · API has delivery, read, reply and team reports
- **Green/verified badge:** both depend on Meta's verification rules, not on the API alone

## When should you switch?

Consider moving to the API when two or more of these are true:

1. More than one person needs to reply to customers.
2. You miss chats or reply late during busy hours.
3. You want to send offers or reminders to hundreds of customers regularly.
4. You want leads from ads to be captured and followed up automatically.
5. You want reports on how fast your team replies and how many leads convert.

## What happens to your number?

Your number can usually be moved to the API, but it then works through the platform instead of the normal app. Plan the move with your provider so your profile, display name and team are ready before you switch.

## The bottom line

Start with the free app. Upgrade to the API when customer conversations become a team activity and you need automation and reports. If you want help deciding, [message MECGURA on WhatsApp](/#contact) — we will look at your current chat volume and suggest the simplest setup that works.`,
  },
  {
    slug: "whatsapp-marketing-ideas-local-business-india",
    title: "10 WhatsApp marketing ideas for local businesses in India (without spamming)",
    excerpt: "Practical WhatsApp marketing ideas for shops, salons, clinics and restaurants in India — that bring repeat customers and keep your number in good standing.",
    tags: "WhatsApp Marketing, Local Business, Ideas",
    body: `WhatsApp is where your customers already are. Used well, it brings back regular customers and turns enquiries into sales. Used badly, it gets your number reported and limited. Here are ten ideas that work for local businesses in India — salons, clinics, sweet shops, boutiques, gyms, coaching centres and restaurants — while staying on the right side of WhatsApp's rules.

## 1. Click-to-WhatsApp ads instead of website forms

Run Facebook or Instagram ads that open a WhatsApp chat. The customer messages you first, which opens a free 24-hour window to reply, and you get their number instantly. An automatic first reply ("Hi! Which service are you looking for?") keeps the lead warm even when you are busy.

## 2. A QR code at the counter

Print a QR code that opens a chat with a ready message like "Hi, I'd like offers on WhatsApp". It is the simplest way to collect genuine opt-ins from walk-in customers.

## 3. Appointment and booking reminders

Salons, clinics and service businesses lose money on no-shows. A reminder the day before, with a button to confirm or reschedule, reduces missed appointments noticeably.

## 4. Order and delivery updates

Order confirmed, packed, out for delivery, delivered — these utility messages build trust and cut down "where is my order?" calls.

## 5. Festival offers — only to people who opted in

Diwali, Lohri, Baisakhi, Raksha Bandhan, Eid and Christmas are natural moments to reach out. Plan offers a week or two early, send them only to customers who agreed to receive offers, and give a clear way to stop messages.

## 6. Ask for a review after a good experience

A short "How was your visit?" message after a service, with a link to your Google review page, helps you collect more reviews. Send it to every customer — not only happy ones — so your reviews stay honest.

## 7. A simple referral reward

Give every customer a referral code. When a friend shares the code on WhatsApp and buys, both get a small reward. Word of mouth is still the strongest marketing in local markets.

## 8. Share your menu, price list or catalogue

Most enquiries are "What's the price?" or "Do you have this?". A WhatsApp catalogue or a quick automated reply with your price list answers them in seconds, day or night.

## 9. Bring back customers you haven't seen in a while

Customers who haven't visited in 60–90 days are worth a gentle "We miss you" message with a small offer. Keep it personal and send it rarely.

## 10. Reply fast — even after hours

Speed wins local business. An AI assistant or automated replies can answer common questions instantly and hand the chat to your team when a person is needed.

---

## Three rules that protect your number

> Only message people who opted in. Use approved templates for messages you send first. Always make it easy to stop.

WhatsApp watches how customers react. If many people block or report your messages, your number's quality drops and Meta can limit how many people you can message. Fewer, more relevant messages almost always perform better.

## How MECGURA helps

MECGURA brings these ideas together in one place — shared inbox, campaigns with opt-in checks, festival planning, reminders, review requests, referral codes and an AI assistant. If you want a ready setup for your type of business, [talk to us on WhatsApp](/#contact).`,
  },
  {
    slug: "how-to-get-whatsapp-opt-in-customers",
    title: "How to collect WhatsApp opt-ins the right way (and why it protects your number)",
    excerpt: "WhatsApp requires customer permission before businesses message them. Simple, honest ways to collect opt-ins in India — and how they keep your number healthy.",
    tags: "WhatsApp API, Opt-in, Compliance",
    body: `Before a business sends WhatsApp messages to a customer, WhatsApp expects that customer to have **agreed to receive them** — this is called an opt-in. It is not just a rule on paper: it directly affects whether your number can keep sending messages.

## Why opt-in matters

WhatsApp's business policy requires permission before you message people. Meta also tracks how customers respond to your messages. When many people block or report a business, its **quality rating** drops, and Meta can restrict how many people the business can start conversations with each day. Good opt-ins lead to good engagement, which keeps your messaging healthy and lets you reach more people over time.

You can read the official rules in Meta's [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy).

## What a good opt-in looks like

A clear opt-in tells the customer three things:

1. **Who** will message them (your business name).
2. **What** they will receive (offers, order updates, reminders).
3. **Where** — on WhatsApp, on the number they gave.

For example: _"Yes, send me offers and order updates from Sharma Sweets on WhatsApp."_

## Easy ways to collect opt-ins

- **Customer messages you first.** Click-to-WhatsApp ads, a "Chat on WhatsApp" button on your website or a QR code at the counter. Then ask once if they'd like offers too.
- **Website and landing page forms.** Add an unticked checkbox: "Send me updates on WhatsApp".
- **Checkout.** Online stores can add the same checkbox at checkout for order updates and offers.
- **In person.** Billing staff can ask, and record the customer's "yes" in your system with the date.
- **Missed-call or keyword.** "Send HI to get offers" works well on posters and packaging.

## Keep a record

Store when and how each customer opted in — date, source (form, QR, chat) and what they agreed to. If a customer ever asks why they received a message, you can answer clearly.

## Make it easy to stop

Every marketing message should give a simple way out, such as "Reply STOP to unsubscribe" — and your system must honour it immediately. People who can leave easily are far less likely to report you.

## Common mistakes to avoid

- Buying or downloading phone number lists.
- Messaging everyone in your phone contacts because "they know us".
- Treating a customer's order or enquiry as permission for unlimited marketing.
- Sending offers every day. Two to four well-planned messages a month is plenty for most local businesses.

## How MECGURA helps

MECGURA records each contact's opt-in status and source, checks it before campaigns go out, handles STOP replies automatically and warns you before you message people who haven't opted in. It is built to keep your number in good standing while you grow. [Message us](/#contact) if you'd like help setting up opt-in collection for your business.`,
  },
];
