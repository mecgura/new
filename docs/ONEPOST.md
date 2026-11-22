# OnePost — Content & PR Studio (Phase 1)

Write a post once, get an editable version for ten channels, preview them side by side, and move the post through approval.
Phase 1 publishes and sends **nothing**. Every version is copied or downloaded by a person.

## What is in Phase 1
- Brand profile per workspace (facts, voice, logo, media contact).
- Content Hub: posts with type, language (English / Hindi / Punjabi / Hinglish), tone, city, keywords, spokesperson and quote, up to 6 images, optional video link.
- AI conversion: website blog, Instagram, Facebook, LinkedIn, YouTube (+ Shorts caption), Google Business Profile, WhatsApp broadcast text, 3 ad variations, press release, journalist pitch email.
- Preview screen, edit any version, rewrite any single version, plain-language checks on every version.
- Status flow: Draft → In review → (Changes requested) → Approved. Scheduled / Published / Failed arrive in Phase 2.
- Copy and download for every version, plus "Download all".

## Setup
1. **Database**: `prisma/migrations/20261126090000_onepost_phase1` (SQLite). Production runs `prisma db push` during `build:vercel`, so deploying creates the five new tables (`OnePostBrand`, `OnePost`, `OnePostMedia`, `OnePostVersion`, `OnePostEvent`).
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
