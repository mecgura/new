# OnePost — Content & PR Studio (Phases 1 and 2)

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
