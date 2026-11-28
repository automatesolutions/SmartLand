import type { ReactNode } from 'react'
import { SUPPORT_EMAIL } from '../lib/support'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-xs">
      <h2 className="text-tagline font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Email() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}?subject=Privacy%20request`} className="text-accent">
      {SUPPORT_EMAIL}
    </a>
  )
}

/** /privacy: what SmartLand does with the details buyers send to sellers, under RA 10173 and its
 * implementing rules. A lawyer reviews this before launch. If the text changes what people agree
 * to, update the consent text in Listing.tsx and bump CONSENT_VERSION in backend/crm.py. */
export function PrivacyPage() {
  return (
    <article className="gutter mx-auto flex max-w-prose flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display-md">Privacy notice</h1>
        <p className="text-ink-secondary">
          How SmartLand handles your details when you message a seller, under the Data Privacy Act of 2012 (Republic Act No. 10173).
        </p>
        <p className="text-caption text-ink-secondary">Last updated November 28, 2026</p>
      </header>

      <Part title="Who we are">
        <p>SmartLand is made by ZALEL LABS, part of NG-BEZALEL STAINLESS CRAFTERS. We decide how your details are handled on SmartLand.</p>
        <p>
          For anything about your details, email <Email />.
        </p>
      </Part>

      <Part title="What we collect">
        <p>When you message a seller about a listing, we keep your name, the phone number or email you give, and your messages.</p>
        <p>If you’re signed in, we link your messages to your account, so you can read the seller’s replies in SmartLand.</p>
        <p>We don’t ask for your address, birthday, or ID.</p>
      </Part>

      <Part title="Counting visits">
        <p>
          When you open a listing, we add 1 to that day’s visit count for it, with where you came from, such as Facebook or a flyer. We keep only
          the daily totals, with nothing that identifies you, and no cookie.
        </p>
        <p>If you message the seller, we keep where you came from with your message, so the seller knows which post reached you.</p>
      </Part>

      <Part title="Listing videos">
        <p>
          If you post a listing and add a video, anyone can watch it on the listing. We store videos with Cloudflare, in its Asia-Pacific region, outside
          the Philippines. When you remove a video or the listing, we delete the video.
        </p>
        <p>Record the property, not people who haven’t agreed to be in it. Don’t show the title or other documents. Add those under Documents, where they stay private.</p>
      </Part>

      <Part title="Calls and live tours">
        <p>
          A seller can call you or show you a property on a live video tour. With a SmartLand account, you join from your Messages; without one, you join
          from the seller’s link with just your name. They see your name, and hear and see you only when your microphone or camera is on. Your camera
          starts off.
        </p>
        <p>
          If you ask for a call or book one, we keep the kind of call, the time, and any note you add, with your conversation. They’re removed with it.
        </p>
        <p>
          Calls go through LiveKit. We don’t record them. LiveKit keeps a record of who joined each call and for how long, stored in the United States,
          outside the Philippines. We keep the names of who joined for 30 days after the call, and only a monthly count of minutes after that.
        </p>
      </Part>

      <Part title="Why we collect it">
        <p>
          So the seller, and the people on their team, can reply to you about that property. You agree to this when you tick the box on the form. We use
          your details for nothing else, and we don’t sell them.
        </p>
        <p>
          To stop spam, we count how many messages come from your internet address. We don’t keep that address with your message.
        </p>
      </Part>

      <Part title="Who sees it">
        <p>
          The person who posted the listing sees it. If they posted it for a business, such as a brokerage, the people on that business’s SmartLand team
          see it too. Other sellers and businesses never see it.
        </p>
        <p>Once a seller has your details, they’re also responsible for how they use them.</p>
      </Part>

      <Part title="Where we keep it">
        <p>
          We store your details with Google Cloud, in its Singapore data center. That’s outside the Philippines. Google keeps them for us under contract,
          and we stay responsible for them.
        </p>
      </Part>

      <Part title="How long we keep it">
        <p>
          We keep your details while the seller is talking with you. Two years after the seller closes your inquiry, we remove your name, contact details,
          and messages automatically. If the seller deletes your inquiry, they’re gone sooner.
        </p>
        <p>Our hosting logs record internet addresses for security. We keep those logs for 30 days.</p>
      </Part>

      <Part title="How we protect it">
        <p>
          Your details travel over an encrypted connection, and Google Cloud encrypts them where they’re stored. Only the seller and their team can open
          your inquiry, and we store passwords only in a scrambled form.
        </p>
      </Part>

      <Part title="Your rights">
        <p>Under the Data Privacy Act, you can:</p>
        <ul className="ml-md flex list-disc flex-col gap-xs">
          <li>Ask what details we have about you, and get a copy.</li>
          <li>Correct details that are wrong.</li>
          <li>Withdraw your consent, or object to how we use your details.</li>
          <li>Ask us to delete or block your details.</li>
          <li>Claim damages if your details are misused.</li>
          <li>
            File a complaint with the National Privacy Commission at{' '}
            <a href="https://privacy.gov.ph" target="_blank" rel="noreferrer" className="text-accent">
              privacy.gov.ph
            </a>
            .
          </li>
        </ul>
        <p>
          To use any of these, email <Email /> or ask the seller. Tell us the listing and the name, phone number, or email you used. We reply and tell
          you what we did.
        </p>
      </Part>

      <Part title="Changes to this notice">
        <p>When we change this notice, we update the date at the top. We don’t use your details in a new way without asking you first.</p>
      </Part>
    </article>
  )
}
