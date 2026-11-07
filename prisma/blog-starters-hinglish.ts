/**
 * Hinglish starter articles for mecgura.tech/blog, published once by the seed (marker "migration:blog_starters_hinglish_2026_11").
 * Facts stay general; anything that changes often (Meta's rates, limits) points to the official source instead of quoting a number.
 */
export const BLOG_STARTERS_HINGLISH: { slug: string; title: string; excerpt: string; tags: string; body: string }[] = [
  {
    slug: "whatsapp-business-app-vs-api-kya-fark-hai",
    title: "WhatsApp Business app aur API mein kya fark hai? Aapke liye kaunsa theek hai",
    excerpt: "Free WhatsApp Business app aur WhatsApp Business API ka seedha comparison: team, automation, campaigns aur kharcha. Apne business ke hisaab se chunein.",
    tags: "WhatsApp API, WhatsApp Business app, Hinglish",
    body: `Bahut se business owners poochte hain: "Main toh WhatsApp Business app chala raha hoon, to API ki kya zaroorat hai?" Jawab aapke business ke size par depend karta hai.

## WhatsApp Business app
- Free hai, phone par install hota hai.
- Greeting message, away message aur quick replies milte hain.
- Ek hi number, aur kuch linked devices tak chal sakta hai.
- Broadcast list chhoti hoti hai aur customer ke paas aapka number saved hona chahiye.

**Kiske liye theek hai:** akele owner, din mein kuch hi enquiries.

## WhatsApp Business API (Platform)
- Provider ke through connect hota hai.
- Shared inbox: ek number par poori team chat kar sakti hai.
- Automation, buttons, chatbot aur AI assistant.
- Template messages se opted-in customers tak offers aur reminders.
- CRM, tags aur integrations.

**Kiske liye theek hai:** growing business, ads se aane wale leads, ya jahan kai log ek number sambhalte hain.

## Kharcha
App free hai. API mein do kharche hote hain: **Meta ke per-message charges** (sirf template messages par) aur **provider ka monthly plan**. Customer ke message ke baad 24 ghante tak aapke replies free hain. Apna andaza [cost calculator](https://mecgura.tech/tools/whatsapp-message-cost-calculator) se lagayein.

## Kaise chunein
- Din mein 10-15 se kam enquiries, aur khud reply kar sakte hain? **App** kaafi hai.
- Ads chala rahe hain, ya team badi hai, ya instant reply chahiye? **API** lein.
- Dono saath bhi chal sakte hain (coexistence), agar aapka number eligible ho.

Meta ke rules badalte rehte hain, isliye decision se pehle official documentation zaroor dekhein.`,
  },
  {
    slug: "whatsapp-business-api-kaise-len-step-by-step",
    title: "WhatsApp Business API kaise lein: step by step (India)",
    excerpt: "Business verification se lekar template approval tak: WhatsApp Business API lene ke saare steps, saaf Hinglish mein.",
    tags: "WhatsApp API, Setup, Hinglish",
    body: `WhatsApp Business API lena mushkil nahi hai, bas steps ka order pata hona chahiye.

## Step 1: Business details taiyar rakhein
Business ka naam, website ya page, address aur registration document (GST, Udyam ya shop registration). Meta kabhi-kabhi business verification maangta hai.

## Step 2: Facebook Business portfolio
Meta Business Suite mein aapka business portfolio hona chahiye. Isi mein WhatsApp account judta hai. Portfolio ke admin aap khud rahein.

## Step 3: Provider chunein
Provider woh company hai jo software deti hai: inbox, automation, campaigns. Poochein: setup kaun karega, Meta ka bill kaun karega, aur support kaisa hai.

## Step 4: Number chunein
Aise number ka istemaal karein jo aap WhatsApp par OTP le sakein (SMS ya call). Agar number pehle se WhatsApp ya Business app par chal raha hai, to provider se poochein ki migration ya coexistence kaise hogi.

## Step 5: Display name
Customer ko jo naam dikhta hai, wo aapke business naam se match hona chahiye. Meta ise approve karta hai.

## Step 6: Templates approve karwayein
Customer ko pehle message bhejne ke liye approved template chahiye. Marketing, utility aur authentication, teeno categories alag hain. [22 free templates](https://mecgura.tech/resources/whatsapp-message-templates) yahan se copy kar sakte hain.

## Step 7: Test aur live
Apne doosre phone se message bhejkar replies, buttons aur hand-over check karein.

## Dhyan rakhein
- Marketing messages sirf unhe bhejein jinhone permission di hai.
- Apna payment method seedha apne WhatsApp account mein lagayein aur dekhein ki kisi partner ki credit line to default nahi hai.

Setup mein madad chahiye? [Free demo](https://mecgura.tech/demo) book karein.`,
  },
  {
    slug: "marketing-utility-template-kya-hai",
    title: "Marketing aur Utility template mein kya fark hai? (aur kaun sa sasta hai)",
    excerpt: "Meta teen tarah ke templates mein charge karta hai. Samjhein ki kaun sa message kis category mein aata hai, aur galti se bachein.",
    tags: "WhatsApp templates, Pricing, Hinglish",
    body: `WhatsApp par jab aap customer ko **pehle** message bhejte hain, to approved template chahiye. Meta in templates ko teen category mein baantta hai.

## 1. Marketing
Offer, discount, festival greeting with offer, new arrival, win-back. Ye sabse mahenga hota hai.

_Example:_ "Diwali offer: 20% off aaj hi. Reply karein."

## 2. Utility
Aise updates jo customer ne pehle se kiye kisi kaam ke baare mein hon: order confirmation, delivery update, appointment reminder, payment receipt.

_Example:_ "Aapka order #1234 confirm ho gaya hai."

## 3. Authentication
OTP aur verification codes.

## Utility sasta kyon hai?
Kyunki ye customer ki apni activity se jura update hai. Aur agar customer ne pichle 24 ghante mein aapko message kiya ho, to us window mein utility template free ho sakta hai.

## Badi galti
Kuch log promotion ko utility mein chhupa dete hain taaki kharcha kam ho. **Aisa na karein.** Meta content dekhta hai, template ko marketing mein re-categorise kar deta hai, aur baar-baar galti par number par restriction lag sakti hai.

## Paise bachane ke sahi tareeke
- Order, booking aur payment updates ko utility template mein hi bhejein.
- Customers ko pehle aapko message karne ke liye prompt karein (QR, Click-to-WhatsApp ad). Phir 24 ghante ke andar reply free hai.
- Marketing sirf tab bhejein jab sach mein offer ho.

Apna mahine ka estimate dekhein: [cost calculator](https://mecgura.tech/tools/whatsapp-message-cost-calculator). Template category ka andaza: [category checker](https://mecgura.tech/tools/whatsapp-template-category-checker).`,
  },
  {
    slug: "click-to-whatsapp-ads-kaise-chalayein",
    title: "Click-to-WhatsApp ads kaise chalayein: chhote business ke liye guide",
    excerpt: "Facebook aur Instagram ads jo seedha WhatsApp chat kholti hain. Setup, welcome message aur leads ko turant reply kaise dein.",
    tags: "Meta Ads, Click-to-WhatsApp, Hinglish",
    body: `Click-to-WhatsApp ad mein customer ad par tap karta hai aur seedha aapke WhatsApp chat mein pahunch jaata hai. Form bharne ki zaroorat nahi, isliye chhote business mein ye achha kaam karta hai.

## Setup (mota-mota)
1. Meta Ads Manager mein campaign banayein. Objective mein aise option chunein jisme **messages** ya **engagement** ho.
2. Message destination mein **WhatsApp** chunein, aur apna WhatsApp number connect karein.
3. Ad creative: saaf photo ya short video, ek hi offer, ek hi baat.
4. Welcome message: customer ke chat kholte hi jo likha dikhega. Chhota aur seedha rakhein.

Options ke naam Meta badalta rehta hai, isliye screen par jo dikhe wahi follow karein.

## Sabse zaroori: reply speed
Ad ka paisa tab hi wasool hota hai jab lead ko **turant** jawab mile. Ghanton baad reply karne par lead thandi ho jaati hai. Yahi kaam automation karta hai: turant welcome, price list, brochure aur buttons.

## Har ad ka alag flow
Agar aapki 3 alag ads hain (salon, bridal, facial), to har ad ke liye alag welcome flow rakhein. MECGURA mein "Ad click" trigger isi kaam ke liye hai.

## Kya na karein
- Ek hi ad mein 5 offers na rakhein.
- Bina permission ke customer ko baar-baar marketing templates na bhejein.
- Pehle din bada budget na lagayein. ₹200-300 per day se test shuru karein.

## Measure kya karein
Kitne chats aaye, kitne ne price list dekhi, kitne ne call mangi, aur kitne customer bane. Sirf "reach" dekhne se paisa nahi banta.

Setup mein madad: [free demo](https://mecgura.tech/demo).`,
  },
  {
    slug: "whatsapp-number-ban-kyon-hota-hai",
    title: "WhatsApp Business number restrict ya ban kyon hota hai? Kaise bachein",
    excerpt: "Spam reports, bina permission ke messages aur low quality rating: number restrict hone ke aam kaaran aur bachne ke tareeke.",
    tags: "WhatsApp API, Quality, Hinglish",
    body: `Sabse bada darr: "Mera WhatsApp number ban ho gaya to?" Zyadatar cases mein wajah ek hi hoti hai: **customers ko wo messages mile jo unhone maange nahi the.**

## Aam kaaran
1. **Bina permission ke messages.** Customer ne opt-in nahi kiya, phir bhi offers bhej diye.
2. **Block aur report.** Jab bahut log aapko block ya report karte hain, to quality rating girti hai.
3. **Galat category.** Promotion ko utility bana kar bhejna.
4. **Ek saath bahut zyada messages**, aur wo bhi irrelevant.
5. **Gande ya bhramak links**, aur jhoothe claims.

## Kaise bachein
- **Opt-in lein** aur record rakhein: form, QR, ya customer ka khud ka message. [Opt-in generator](https://mecgura.tech/tools/whatsapp-opt-in-message-generator) se text bana lein.
- Har marketing message mein **STOP** ka aasaan tareeka dein.
- Message **kaam ka** ho: kisi ko 5 baar ek hi offer na bhejein.
- Quality rating **Meta Business Suite** mein dekhte rahein.
- Kam logon se shuru karein, response dekhein, phir badhayein.

## Agar warning aaye
Messages turant kam karein, template check karein, aur Meta ke appeal ka tareeka follow karein. Dobara wahi galti na dohrayein.

## Yaad rakhein
WhatsApp aapko customers se jodta hai, spam bhejne ka zariya nahi hai. Permission-based approach lambe samay mein sasti aur safe hai.`,
  },
  {
    slug: "whatsapp-par-leads-ko-turant-reply-kaise-dein",
    title: "Leads ko 5 minute mein reply kaise dein: chhote business ka tareeka",
    excerpt: "Enquiry jaldi mile to customer banne ke chance badh jaate hain. Turant reply ke liye simple system, bina bada staff rakhe.",
    tags: "Leads, Automation, Hinglish",
    body: `Customer ek se zyada dukaan ya service dekhta hai. Jo pehle sahi jawab de deta hai, wahi aksar jeet jaata hai. Isliye reply speed business ka paisa hai.

## Problem
Aap customer ke saath busy hain, phone silent hai, ya raat ho gayi hai. Enquiry subah tak thandi ho jaati hai.

## Simple system
### 1. Turant welcome
Message aate hi: "Namaste! Aapka message mil gaya. Neeche se chuniye." Saath mein 3 button: Price list, Booking, Team se baat.

### 2. Price list aur brochure
Jo sawaal sabse zyada aata hai uska jawab pehle se taiyar rakhein: price list, timings, location, brochure.

### 3. Lead save karein
Naam, city, requirement apne aap save hon. Spreadsheet mein copy-paste ka kaam khatam.

### 4. Hot lead ko team tak
Jo "call karo" ya "team se baat" chune, use turant staff ko assign karein aur notification dein.

### 5. Follow-up
Jo customer chup ho jaaye, use ek baar politely yaad dilayein. Baar-baar nahi.

## Result kya mil sakta hai
Pata chalta hai kaun serious hai, kisne kab poocha, aur team kise pehle call kare. Staff ka time repeat sawaalon mein kam jaata hai.

## Shuruaat kaise karein
Pehle apne 5 sabse common sawaalon ki list banayein. Unke jawab likhein. Wahi aapka pehla automation hai.

[Free demo](https://mecgura.tech/demo) mein hum aapke business ke liye ye set karke dikhate hain.`,
  },
  {
    slug: "festival-offers-whatsapp-par-kaise-bhejein",
    title: "Festival offers WhatsApp par kaise bhejein (bina spam ke)",
    excerpt: "Diwali, Holi ya Baisakhi: sahi time par, sahi customers ko, permission ke saath offer bhejne ka tareeka.",
    tags: "Festival marketing, WhatsApp campaigns, Hinglish",
    body: `Festival ke din customers kharidari ke mood mein hote hain. Par galat tareeke se bheja gaya offer spam lagta hai aur number ko nuksaan pahunchata hai.

## Pehle permission
Offer sirf unhe bhejein jinhone WhatsApp par updates lene ki permission di ho. Naye customers se billing ke time pooch lein: "Offers aur updates WhatsApp par chahiye?"

## Template banayein
Offer marketing template hota hai. Chhota rakhein:
"Happy Diwali from {{1}}! 🎉 {{2}} tak {{3}} ka offer. Book ya order ke liye reply karein."
Isse pehle Meta approval chahiye. [22 ready templates](https://mecgura.tech/resources/whatsapp-message-templates) dekhein.

## Timing
- Festival se 3-5 din pehle pehla message.
- Festival ke din ek chhota greeting.
- Raat ke time messages na bhejein.

## Segment
Sabko ek hi message na bhejein. Regular customers ko alag, purane customers ko "wapas aaiye" wala offer.

## Ek hi call to action
"Reply karein" ya "Book karein". Teen links na daalein.

## Result dekhein
Kitne ne reply kiya, kitne ne STOP likha. STOP zyada aaye to offer ya frequency galat hai.

## Kharcha
Marketing messages ke Meta charges alag lagte hain. Bhejne se pehle [cost calculator](https://mecgura.tech/tools/whatsapp-message-cost-calculator) se andaza lagayein.`,
  },
  {
    slug: "google-reviews-whatsapp-se-kaise-badhayein",
    title: "WhatsApp se Google reviews kaise badhayein (asli customers se)",
    excerpt: "Khush customer se sahi time par review maangne ka simple tareeka, aur naraaz customer ko pehle sambhalne ka system.",
    tags: "Reviews, Local SEO, Hinglish",
    body: `Google par achhe reviews aapke business ko naye customers ke saamne bharosemand banate hain. Par reviews **asli** hone chahiye. Kharide hue ya jhoothe reviews Google ke rules ke khilaaf hain aur nuksaan karte hain.

## Kab maangein
Service poori hone ke kuch ghante baad, jab experience taza ho.

## Kaise maangein
Ek chhota message:
"Namaste {{1}}, {{2}} aane ke liye shukriya. Aapka experience kaisa raha? 1 se 5 tak number bhejein."

Google ke rules ke hisaab se **sirf khush customers se review maangna** (review gating) theek nahi maana jaata. Isliye:

- **Sabhi customers** ko review ka link dein, rating chahe jo ho.
- Jo **1-3** de, use alag se bhi poochein: "Hum kya behtar kar sakte hain?" aur team ko alert dein, taaki problem sulajh sake.
- Naraaz customer ko review karne se **rokein nahi**, aur review ke badle koi inaam na dein.

## Link kahan se milega
Google Business Profile mein "Ask for reviews" par short link milta hai.

## Frequency
Ek customer se ek hi baar maangein. Reminder zyada se zyada ek.

## Automation
MECGURA mein feedback request, rating aur low-rating alert ek system mein hain. [Demo dekhein](https://mecgura.tech/demo).`,
  },
  {
    slug: "whatsapp-chatbot-chhote-business-ke-liye",
    title: "WhatsApp chatbot chhote business ke liye: kya kaam karta hai aur kya nahi",
    excerpt: "Chatbot kab kaam aata hai, kab insaan chahiye, aur 'bot jaisa na lage' iske liye simple rules.",
    tags: "Chatbot, Automation, Hinglish",
    body: `"Chatbot" sunkar log darte hain ki customer ko machine jaisa lagega. Sahi tareeke se banaya chatbot customer ka time bachata hai aur aapka bhi.

## Chatbot kahan achha hai
- Timings, location, price list jaise repeat sawaal.
- Booking ya enquiry ki shuruaati details lena (naam, city, requirement).
- Raat ya busy time mein turant reply.

## Kahan insaan chahiye
- Complaint, mol-bhaav, special request.
- Sehat se jude sawaal (clinic): bot salah na de, team ko de.
- Jab customer khud kahe "team se baat karao".

## Achhe chatbot ke rules
1. **Chhota rakhein.** 2-3 option, lambi script nahi.
2. **Hamesha insaan ka raasta ho.** "Team se baat" button zaroor.
3. **Customer ki bhasha.** Hinglish ya Punjabi mein likhein, agar customer wahi bolte hain.
4. **Jo nahi pata wo na bolein.** Jhoothe jawab se bharosa tootta hai.
5. **Test karein.** Khud apne doosre phone se pura flow chalayein.

## AI assistant aur rule-based bot
Rule-based bot buttons par chalta hai aur kabhi galat jawab nahi deta. AI assistant sawaalon ko samajh kar jawab deta hai, par use aapke approved FAQs tak seemit rakhna chahiye.

## Shuruaat
Apne 5 sabse common sawaalon ke jawab likhein. Ye hi aapka pehla chatbot hai. Dekhiye [aapke business ke liye kaise](https://mecgura.tech/whatsapp-automation).`,
  },
  {
    slug: "whatsapp-catalogue-aur-price-list-kaise-share-karein",
    title: "WhatsApp par price list, catalogue aur brochure kaise share karein",
    excerpt: "Customer ko turant sahi cheez bhejne ke tareeke: price list image, PDF brochure aur button wale replies.",
    tags: "Catalogue, Brochure, Hinglish",
    body: `Customer ka sabse pehla sawaal aksar hota hai: "Rate kya hai?" Agar aap har baar type karte hain, to time jaata hai aur galtiyan bhi hoti hain.

## Option 1: Price list image
Ek saaf image banayein (Canva jaise tool se). Text bada rakhein, kyunki customer phone par dekhta hai. 3 MB se chhoti file rakhein.

## Option 2: PDF brochure
Zyada details ho to PDF theek hai. File chhoti rakhein taaki jaldi khule. Pehla page sabse zaroori baat bataye.

## Option 3: Text list
Chhote items ke liye seedha message bhi chalta hai:
_Price list_
- Haircut: ₹...
- Facial: ₹...
(Apni asli prices likhein.)

## Button ke saath bhejein
Brochure ke saath 3 button dein: Price list, Booking, Team se baat. Customer ek tap mein agle step par chala jaata hai.

## Automation mein
MECGURA mein welcome message ke saath image ya PDF attach hota hai. Ad se aane wale har customer ko wahi turant mil jaata hai. Har ad ka alag welcome aur brochure rakh sakte hain.

## Dhyan rakhein
- Purane rates na bhejein. Price badle to image turant update karein.
- Customer ki permission ke bina PDF baar-baar na bhejein.
- Brochure mein apna WhatsApp number aur address zaroor rakhein.

[Free demo](https://mecgura.tech/demo) mein dekhein ye kaise chalta hai.`,
  },
  {
    slug: "whatsapp-automation-se-appointment-booking",
    title: "WhatsApp par appointment booking automatic kaise karein (salon, clinic, coaching)",
    excerpt: "Customer ko slot dene ka simple flow: service, din, time poochna, aur team ko confirm karne ke liye dena.",
    tags: "Appointment, Booking, Hinglish",
    body: `Salon, clinic aur coaching mein sabse zyada time appointment ke messages mein jaata hai: "Kal 4 baje ho jayega?" Is process ko seedha banaya ja sakta hai.

## Flow ka structure
1. Customer: "Appointment chahiye."
2. Bot: "Kis service ke liye?" (3 button: Haircut, Facial, Consultation)
3. Bot: "Kaunsa din theek hai?" (Aaj, Kal, Koi aur din)
4. Bot: "Kis time?" (Subah, Dopahar, Shaam)
5. Bot: "Request mil gayi. Team confirm karegi." Aur team ko notification jaati hai.

## Confirm kaun karta hai
Bot slot **request** leta hai, aur aapki team exact time confirm karti hai. Is tarah double-booking nahi hoti, kyunki slot aapke haath mein rehta hai.

## Reminder
Appointment se ek din pehle utility template: "Namaste {{1}}, kal {{2}} baje aapki appointment hai. Confirm ke liye YES likhein." [Templates yahan](https://mecgura.tech/resources/whatsapp-message-templates) hain.

## Clinic mein dhyan
Bot medical salah na de. Sirf timings, doctor ki jaankari aur appointment request le. Symptoms par team ko de.

## Follow-up
Visit ke baad ek feedback message, aur zaroorat ho to follow-up ki yaad.

## Shuruaat
Apni 3 sabse zyada booked services likhein, aur available time slots. Wahi flow ka base hai. [Salon](https://mecgura.tech/whatsapp-automation/salon), [clinic](https://mecgura.tech/whatsapp-automation/clinic) aur [coaching](https://mecgura.tech/whatsapp-automation/coaching) ke examples dekhein.`,
  },
  {
    slug: "whatsapp-opt-in-hinglish-mein-kaise-lein",
    title: "Customer ki WhatsApp permission (opt-in) kaise lein: simple tareeke",
    excerpt: "Opt-in kya hai, kyon zaroori hai, aur dukaan, website aur QR par permission lene ke ready-to-use tareeke.",
    tags: "Opt-in, WhatsApp marketing, Hinglish",
    body: `**Opt-in** ka matlab hai: customer ne khud kaha ki "haan, mujhe WhatsApp par aapke updates aur offers chahiye." Bina iske marketing messages bhejna WhatsApp ke rules ke khilaaf hai aur number ke liye risky.

## Opt-in lene ke 5 tareeke
1. **Billing counter par:** "Offers aur updates WhatsApp par chahiye? Haan likhein." Register mein tick karein.
2. **QR code:** "Scan karein aur offers pao." Customer khud message karta hai, isse sabse mazboot opt-in banta hai. [QR generator](https://mecgura.tech/tools/whatsapp-qr-code-generator).
3. **Website form:** number ke saath checkbox: "Mujhe WhatsApp par updates chahiye."
4. **Ad se aaya chat:** jab customer pehle aapko message kare, to us chat mein poochein: "Kya hum offers aur reminders bhej sakte hain? YES likhein."
5. **Event ya camp:** sign-up sheet par saaf likhein ki kis cheez ke liye number le rahe hain.

## Message mein kya likhein
- Aap kaun hain (business ka naam).
- Kya bhejenge (offers, order updates, reminders).
- Kitni baar.
- Kaise rukna hai (STOP).

[Opt-in message generator](https://mecgura.tech/tools/whatsapp-opt-in-message-generator) se ready text bana sakte hain.

## Record rakhein
Kab, kahan aur kis tareeke se permission mili: ye likha hona chahiye. MECGURA mein contact ke saath opt-in ka record rehta hai.

## STOP ko turant maanein
Kisi ne STOP likha to us par aur marketing na bhejein. Isse number ki quality bachti hai.`,
  },
];
