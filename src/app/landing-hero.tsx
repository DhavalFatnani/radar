import Link from "next/link";
import { Wordmark } from "./components/ui/wordmark";

// Public marketing surface for signed-out visitors. Purely presentational —
// no auth import — so it render-tests without the NextAuth runtime.
export function LandingHero() {
  return (
    <main className="landing">
      <section className="landing-inner" aria-labelledby="landing-headline">
        <Wordmark className="landing-wordmark" />
        <h1 id="landing-headline" className="landing-headline">
          Lead intelligence,
          <br />
          from signal to signed.
        </h1>
        <p className="landing-subcopy">Source, qualify, and close vendor deals from one workspace.</p>
        <Link href="/login" className="btn btn-primary landing-cta">
          Sign in
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <ul className="landing-capabilities" aria-label="What Radar does">
          <li>Source</li>
          <li>Qualify</li>
          <li>Close</li>
        </ul>
      </section>
    </main>
  );
}
