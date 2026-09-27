import { connection } from "next/server";
import { Brand } from "@/components/brand";
export default async function Home() {
  // Nonces require request-time rendering so cached HTML cannot reuse a credential.
  await connection();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7">
        <Brand />
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold">
          Coming soon
        </span>
      </header>
      <main
        id="main"
        className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr] md:items-center md:py-32"
      >
        <section>
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            Good times start here
          </p>
          <h1 className="max-w-2xl text-5xl font-bold leading-[1.08] tracking-tight md:text-7xl">
            Your next experience.
            <br />
            <span className="text-[var(--accent)]">One ticket away.</span>
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-[var(--muted)]">
            A simpler way to be there. TicketSquare is getting ready to bring
            event tickets from your first click to the entrance.
          </p>
          <p className="mt-8 text-sm text-[var(--muted)]">
            Ticket sales are not open yet. Check back for our first event.
          </p>
        </section>
        <aside
          aria-label="TicketSquare introduction"
          className="rounded-3xl bg-[var(--ink)] p-9 text-white"
        >
          <p className="text-sm uppercase tracking-widest text-orange-200">
            Made for the moment
          </p>
          <div
            aria-hidden="true"
            className="my-10 text-7xl font-bold text-orange-400"
          >
            Admit
            <br />
            one.
          </div>
          <div className="border-t border-dashed border-slate-500 pt-6">
            <p className="text-xl font-semibold">
              More experiences. Less friction.
            </p>
            <p className="mt-3 leading-relaxed text-slate-300">
              Discover the event. Get your ticket. Be there.
            </p>
          </div>
        </aside>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-[var(--border)] px-6 py-6 text-sm text-[var(--muted)]">
        TicketSquare · Built for shared experiences.
      </footer>
    </div>
  );
}
