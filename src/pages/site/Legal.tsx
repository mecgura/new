import SiteLayout from './SiteLayout'
import { BRAND } from '../../lib/brand'

const updated = '26 September 2026'

function Doc({ title, sections }: { title: string; sections: [string, string][] }) {
  return (
    <SiteLayout>
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>
        <div className="mt-10 space-y-8">
          {sections.map(([h, p]) => <section key={h}><h2 className="font-display text-lg font-semibold text-white">{h}</h2><p className="mt-2 whitespace-pre-line leading-relaxed text-soft">{p}</p></section>)}
        </div>
        <div className="mt-12 rounded-2xl border border-line bg-card p-5 text-sm text-soft">
          Questions? Contact MECGURA — Email: <a className="text-brand-2" href={`mailto:${BRAND.email}`}>{BRAND.email}</a> · Phone: <a className="text-brand-2" href={BRAND.phoneHref}>{BRAND.phone}</a> · Website: <a className="text-brand-2" href={BRAND.website}>{BRAND.websiteLabel}</a>
        </div>
      </article>
    </SiteLayout>
  )
}

export function Terms() {
  return <Doc title="Terms of Service" sections={[
    ['1. About the service', `MECGURA WhatsApp (${BRAND.domain}) is a software platform operated by MECGURA that lets businesses use the official WhatsApp Business Platform provided by Meta. By creating an account you agree to these terms on behalf of your business.`],
    ['2. Your account', 'You are responsible for the accuracy of your business details, for keeping login credentials secure and for all activity in your workspace, including actions by team members you invite.'],
    ['3. WhatsApp & Meta policies', 'You must comply with the WhatsApp Business Messaging Policy, WhatsApp Commerce Policy and Meta terms. You may only message people who have given you permission (opt-in), must honour opt-out requests, and must not send spam, prohibited content or misleading messages. Meta may restrict or ban numbers that violate its policies; MECGURA is not responsible for such actions.'],
    ['4. Plans, trials & payments', 'Paid plans are billed in advance monthly or yearly, plus applicable GST. Plan limits (numbers, users, contacts, messages, flows, AI replies) apply as shown in your billing page. WhatsApp conversation/message charges are levied by Meta and billed separately by Meta. Fees already paid are non-refundable except where required by law.'],
    ['5. Acceptable use', 'You must not use the platform for unlawful activity, to harass people, to distribute malware, or to attempt to access other customers’ data. We may suspend workspaces that put the platform, other customers or WhatsApp numbers at risk.'],
    ['6. Data', 'You own the contact and conversation data in your workspace. You grant MECGURA the rights needed to host and process it to provide the service. You can export your contacts at any time.'],
    ['7. Availability & liability', 'We work to keep the service available but do not guarantee uninterrupted operation, and Meta’s APIs are outside our control. To the maximum extent permitted by law, MECGURA’s total liability is limited to the fees you paid in the three months before the claim.'],
    ['8. Termination', 'You may cancel at any time from your account or by contacting us. We may terminate or suspend accounts that breach these terms. After termination, workspace data may be deleted after 30 days.'],
    ['9. Governing law', 'These terms are governed by the laws of India. Courts in Punjab, India have jurisdiction.'],
  ]} />
}

export function Privacy() {
  return <Doc title="Privacy Policy" sections={[
    ['What we collect', 'Account information (name, email, mobile, business details); workspace data you add or receive (contacts, messages, media, orders, payments metadata); usage and device information (logs, IP address, browser).'],
    ['How we use it', 'To provide and secure the service, deliver WhatsApp messages through Meta, run automations and AI features you enable, provide support, process payments and send service notifications.'],
    ['AI features', 'When you enable the AI assistant, relevant conversation text and your knowledge base are sent to our AI model provider to generate replies. AI is off by default and can be turned off at any time.'],
    ['Sharing', 'We share data with Meta (WhatsApp Business Platform), payment processors (Razorpay), hosting and AI providers strictly to operate the service. We do not sell personal data.'],
    ['Security', 'Access tokens and secrets are encrypted at rest, passwords are hashed, and access within a workspace is controlled by roles and permissions.'],
    ['Retention', 'We keep data while your workspace is active. After closure, data is deleted within 30 days unless the law requires us to keep it longer.'],
    ['Your rights', `You can access, correct, export or delete your data. Customers of our clients should contact the business that messaged them. For privacy requests, email ${BRAND.email}.`],
  ]} />
}
