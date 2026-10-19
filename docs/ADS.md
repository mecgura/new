# Ads Manager (click-to-WhatsApp ads)

What it does: a workspace owner or manager creates a click-to-WhatsApp ad in MECGURA (picture, text, budget, age, gender). MECGURA creates the campaign, ad set, creative and ad on the client's Meta ad account **paused**, then the user starts or pauses it. Results (spend, views, clicks) are pulled from Meta; chats and cost per chat come from the click-to-WhatsApp referrals that already arrive on the webhook.

Switched on per client: Super Admin → Clients → Services → **Ads Manager**. Off by default.

## Connect an ad account (agency model)
1. Client: Business Settings → Partners → share the **ad account** and the **Facebook Page** with your business (full control).
2. You: Business Settings → System users → create one → assign both assets → generate a token for the MECGURA app with `ads_management`, `ads_read`, `pages_read_engagement`, expiry Never.
3. In MECGURA (owner or Super Admin): Ads Manager → paste ad account ID (numbers only), Page ID and the token. It is verified with Meta and stored encrypted.

## What is verified and what is not
Covered by tests against a mocked Graph API: the order of calls, that everything is created PAUSED, budget in paise, the WhatsApp destination, clean-up of a half-built ad, spend sync and cost per chat.

**Not yet verified against live Meta.** Field names follow Meta's Marketing API docs, but the first real ad can still be rejected for a missing or renamed field. Meta's own error text is shown to the user unchanged and kept on the ad record; fix from that.

## Meta approval (the part only you can do)
In development mode the app can already work with ad accounts of people who have a role on the app, and with assets of your own business. To manage **other businesses'** ad accounts at scale, request in App Review:
* `ads_management` and `ads_read` (Advanced access), `pages_read_engagement`, `business_management` if asked.
* Business Verification must be complete (it is, if you are a Tech Provider).
* Prepare: privacy policy and terms URLs (https://mecgura.tech/privacy, /terms), a screen recording of the full flow (connect, create paused ad, start with the budget confirmation, pause, results), and test instructions with a demo workspace.
* Meta usually asks for some successful API calls on the permission before approving, so test on your own ad account first.

Spend is always billed by Meta to the payment method on the client's ad account; MECGURA never handles ad money.
