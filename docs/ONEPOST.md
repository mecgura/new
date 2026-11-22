# OnePost — Content & PR Studio (Phases 1 to 4)

Write a post once, get an editable version for ten channels, preview them side by side, and move the post through approval.
Phase 1: write, preview, edit and approve. Phase 2 (below): connect accounts and publish or schedule an **approved** post. Nothing is ever published without a person approving it first and confirming the channels.

## What is in Phase 1
- Brand profile per workspace (facts, voice, logo, media contact).
- Content Hub: posts with type, language (English / Hindi / Punjabi / Hinglish), tone, city, keywords, spokesperson and quote, up to 6 images, optional video link.
- AI conversion: website blog, Instagram, Facebook, LinkedIn, YouTube (+ Shorts caption), Google Business Profile, WhatsApp broadcast text, 3 ad variations, press release, journalist pitch email.
- Preview screen, edit any version, rewrite any single version, plain-language checks on every version.
- Status flow: Draft → In review → (Changes requested) → Approved. Scheduled / Published / Failed arrive in Phase 2.
- Copy and download for every version, plus "Download all".

## Setup
1. **Database**: `prisma/migrations/20261126090000_onepost_phase1` and `20261127090000_onepost_phase2` (SQLite). Production runs `prisma db push` during `build:vercel`. The exact Postgres changes are in `docs/onepost-postgres-plan.sql`: eight new tables and their indexes and foreign keys, no change to any existing table or column.
2. **AI key**: set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in Vercel. Provider and model come from the existing Super Admin → Integrations AI settings. With no key, OnePost writes clearly labelled *demo drafts* from the client's own words.
3. **Switch the module on per client**: Super Admin → Clients → client → Services → "OnePost — Content & PR Studio".
4. No cron job is needed in Phase 1.

## Roles
| Role | Can do |
|---|---|
| Super Admin | Everything in any workspace; switches the module on or off per client |
| Owner | Everything, including approve / request changes |
| Manager | Create, edit, rewrite, send for review, reopen, delete any post, edit brand profile |
| Agent | Create posts and edit / rewrite / delete **their own drafts**; read everything |

Editing a post that is in review or approved sends it back to draft, so approved content is never changed silently.

## Rules built in
- Every table and query is scoped by `organizationId`.
- Press-release quotes are only the words the client typed; the AI cannot change them. No quote supplied means no quote.
- Strong claims ("guaranteed", "100%", "best in town"), phone numbers in Google posts, over-long fields and copy-pasted wording across channels are flagged on the card.
- Images are stored in the database like the Social Media module (3 MB each). Video is a link in Phase 1.

## Test checklist
1. Super Admin enables OnePost for a client. A client user sees **OnePost** in the sidebar; another client does not.
2. Brand profile: fill it, upload a logo, save, reload.
3. New post → open it → add a photo → **Write all versions**. Ten cards appear, each with a preview.
4. Edit the Instagram version and save. Rewrite the Facebook version only.
5. Copy and Download on a card, and **Download all**.
6. As Agent: you can draft but have no Send for review or Approve button. As Manager: Send for review only. As Owner: Approve and Request changes.
7. Approve, then edit a version: the post returns to Draft.
8. Press release: with no quote typed there is no quote; with a quote typed it appears word for word.
9. Existing pages (Dashboard, Inbox, Social Media, Campaigns, Billing) look and behave as before.


---

# Phase 2: connections, publishing, scheduling, calendar

## What is in Phase 2
- **Connections** tab (owner only): Facebook and Instagram reuse the accounts already connected in **Channels** (the same ones Social Media uses, no second integration). LinkedIn and Google Business Profile connect with OAuth. WordPress connects with an Application Password.
- **Publish** panel on an approved post: tick channels, **Publish now** or **Schedule** (India time), confirm. Everything is checked first; if any chosen channel has a problem nothing is queued.
- What goes out is a **snapshot** of the approved content taken when it is queued. Editing the live version afterwards cannot change what is sent.
- Retries: a temporary failure (timeout, rate limit, 5xx) is tried again after 5, 20 and 60 minutes, three attempts in all. A permanent error (bad token, refused post) fails at once with the channel's own reason. **Retry failed** sends again by hand.
- **Calendar** tab: month and week view of queued, published and failed posts. Drag a waiting post to another day to reschedule it (time of day stays).
- **Files**: photos and videos upload from the browser straight to **Vercel Blob** (photos up to 8 MB, videos up to 300 MB). Only OnePost uses Blob. The Social Media module keeps its own database storage.

## Status flow
Draft → In review → Approved → **Scheduled** → **Published** or **Failed**. Cancelling waiting posts returns an approved post to Approved. A failed post can be retried or reopened for editing.

## Roles
| Role | Phase 2 |
|---|---|
| Owner | Connect and disconnect accounts, publish, schedule, cancel, retry, move on calendar |
| Manager | Publish, schedule, cancel, retry, move on calendar (cannot connect accounts) |
| Agent | See results only |

## Setup (environment, all server-side)
| Variable | For | Notes |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Photos and videos | Added by the Vercel Blob store `mecgura-onepost` (region bom1, public access) connected to the project |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn sign-in | Create an app in the LinkedIn developer portal, add the product **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Redirect URL: `https://mecgura.tech/api/onepost/oauth/linkedin/callback` |
| `LINKEDIN_SCOPES` (optional) | Page posting | Default `openid profile w_member_social` (personal profile). Add `w_organization_social r_organization_admin` only after LinkedIn approves the Community Management API |
| `LINKEDIN_API_VERSION` (optional) | LinkedIn REST | Default `202606`. Change it if LinkedIn reports the version is no longer supported |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Business Profile | OAuth client of type Web. Redirect URI: `https://mecgura.tech/api/onepost/oauth/gbp/callback`. Enable the Business Profile APIs and ask Google for API access: until Google approves the project, Google refuses posts |
| `NEXT_PUBLIC_APP_URL` | Redirect URIs | Already set (`https://mecgura.tech`) |

Scheduling runs inside the existing scheduler tick (`runScheduledWork`), so no new cron job is needed. Publish now runs immediately.

## Test checklist (Phase 2)
1. Connections tab: Facebook and Instagram show the Channels accounts. Connect LinkedIn and (if keys are set) Google. Connect a WordPress site with an Application Password.
2. Create a post with a photo, write versions, send for review, approve as owner.
3. Publish panel: channels without a connection explain why they are unavailable. Tick one, **Schedule** a time a few minutes ahead, confirm. It shows Queued and appears on the Calendar.
4. Drag it to another day on the Calendar. The time stays the same.
5. **Cancel waiting posts** returns the post to Approved.
6. Schedule again, wait for the time, check the channel and the **What happened** list (link, or the channel's error).
7. Break a connection on purpose (disconnect then try): the channel shows a clear reason and nothing is sent.
8. As Manager: can publish but not connect. As Agent: sees results only.
9. Existing pages, Social Media, Channels and Campaigns behave as before.

## Not in Phase 2
Video posting to Facebook and Instagram (the existing Social Media publishing code posts photos and text only), YouTube, WhatsApp campaign hand-off, the client approval link, Event Mode, Media Studio (Phase 3). LinkedIn Company Pages need LinkedIn's approval first.

---

# Phases 3 and 4: Media Studio, YouTube, WhatsApp hand-off, client review, Event Mode, PR, SEO, reports

## What is in Phases 3 and 4

- **Media Studio.** Resized copies of a photo (1:1, 4:5, 9:16, 16:9), optionally with the brand logo. Each channel gets the shape it likes (Instagram 4:5, Facebook/LinkedIn/Google/blog/YouTube 16:9). Video cover frame picker. Originals are never changed.
- **YouTube.** Uploads an approved video (title, description, tags) with a privacy setting chosen in Connections (public / unlisted / private) and the cover frame as thumbnail.
- **WhatsApp hand-off.** Turns the approved WhatsApp text into a **draft** template in WhatsApp → Templates. It is never submitted to Meta and never sent.
- **Client review link.** A private link for a client without a login. Only a hash of the link is stored. It expires, works once (approve or ask for changes), and stops working if the post changes after the link was made.
- **Event Mode.** One event becomes five drafts (teaser, live update, recap blog, gallery post, press release) sharing the event's facts. "Use these photos in all event posts" copies a post's photos to its siblings.
- **PR / News.** Media contacts (add, edit, CSV import, unsubscribe), press releases as PDF or Word, pitch emails to chosen contacts after approval, open tracking (rough), coverage links, per-release numbers.
- **SEO.** Google Search Console (read-only): clicks, impressions, top keywords.
- **Monthly report.** Posts, publishing results by channel, failures, per-post links, press numbers, search numbers; JSON in the app and PDF download.

## New environment variables

| Name | For |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Business Profile, YouTube and Search Console (one Google app). Redirect URIs: `/api/onepost/oauth/gbp/callback`, `/api/onepost/oauth/youtube/callback`, `/api/onepost/oauth/gsc/callback` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Pitch emails to journalists. Without them the PR tab says email is not set up and nothing is sent. |
| `BLOB_READ_WRITE_TOKEN` | Already used in Phase 2 (media and video). Keep it marked Sensitive in Vercel. |

Keys shown as "not configured" in the app are simply missing: every screen works and tells the person what is missing.

## Database

Phases 1 to 4 only **add**: 11 new tables and foreign keys from the new tables to `Organization`. No existing table or column is altered, renamed or dropped. The exact Postgres statements are in `docs/onepost-postgres-plan.sql`. Take a Neon backup before the first production deploy.

## Rules that still hold

- Nothing is published, emailed or submitted without a person approving it first.
- Every table carries `organizationId`; every route checks the workspace.
- Tokens are encrypted; review links and unsubscribe/open links store only random tokens.
- The Social Media module and `src/providers/meta` are untouched; Facebook/Instagram posting reuses them.

## Test checklist (Phases 3 and 4)

1. Upload a photo, make 1:1 and 4:5 copies with the logo; the Instagram post uses the 4:5 copy.
2. Upload a video, pick a cover frame; (with Google keys) publish to YouTube as Private first.
3. Approve a post with a WhatsApp version → "Create WhatsApp draft" → the template appears as a draft.
4. Send a post for review → create a client link → open it in a private window → approve or ask for changes.
5. New event campaign → five drafts appear with the event name and phase.
6. PR tab → add a contact, download the press release (Word, and PDF for English) → approve → email yourself first.
7. Click the unsubscribe link in that email → confirm → the contact shows "Unsubscribed" and is skipped next time.
8. Reports → pick the month → download the PDF.

## Not done / limits (honest list)

- **Not tested against the live services.** LinkedIn, Google Business Profile, YouTube, Search Console and Resend are covered by tests with mocked responses. They need real keys and, for Google and LinkedIn, the providers' own API approvals.
- **LinkedIn**: the API version defaults to `202606` (`LINKEDIN_API_VERSION`) and was not checked live. Company Page posting needs LinkedIn's approval.
- **Google Business Profile** and **YouTube**: Google may require an audit. Until then YouTube can force new uploads to Private.
- **Facebook/Instagram video**: the existing Social Media code posts photos and text only, so videos are not posted there. Changing it needs your OK.
- **YouTube large videos**: limited by the server's function time (about 55 seconds). Upload very large files in YouTube Studio.
- **PDF** export supports English (Latin) text only. Hindi or Punjabi text: use the Word file.
- **Open tracking** is a rough signal (some mail apps block or pre-load the pixel).
- **Reach** (people who saw each post) is not collected from any channel; reports say so.
- **WordPress**: self-hosted sites only (Application Passwords), not wordpress.com.
