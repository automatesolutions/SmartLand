import type { ReactNode } from 'react'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-xs">
      <h2 className="text-tagline font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** /privacy: what SmartLand does with the details buyers send to sellers.
 * DRAFT: a lawyer reviews this before launch. */
export function PrivacyPage() {
  return (
    <article className="gutter mx-auto flex max-w-prose flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display-md">Privacy notice</h1>
        <p className="text-ink-secondary">
          How SmartLand handles your details when you message a seller, under the Data Privacy Act of 2012 (Republic Act No. 10173).
        </p>
      </header>

      <Part title="What we collect">
        <p>When you message a seller about a listing, we keep your name, the phone number or email you give, and your messages.</p>
        <p>We don’t ask for your address, birthday, or ID, and we don’t keep your IP address with your message.</p>
      </Part>

      <Part title="Why we collect it">
        <p>So the seller, and the people on their team, can reply to you about that property. We use it for nothing else, and we don’t sell it.</p>
      </Part>

      <Part title="Who sees it">
        <p>
          The person who posted the listing sees it. If they posted it for a business, such as a brokerage, the people on that business’s SmartLand team
          see it too. Other sellers and businesses never see it.
        </p>
      </Part>

      <Part title="How long we keep it">
        <p>
          We keep it while the seller is talking with you. Two years after the seller closes your inquiry, we remove your name, contact details, and
          messages automatically.
        </p>
      </Part>

      <Part title="Your rights">
        <p>
          You can ask to see, correct, or delete your details at any time. Ask the seller, or contact SmartLand. You can also file a complaint with the
          National Privacy Commission.
        </p>
      </Part>
    </article>
  )
}
