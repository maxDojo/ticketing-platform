export function Brand() {
  return (
    <span className="inline-flex items-center gap-3 font-bold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-lg bg-[var(--brand)] text-xl text-white"
      >
        T
      </span>
      <span>
        TicketSquare<span className="text-[var(--brand)]">.ng</span>
      </span>
    </span>
  );
}
