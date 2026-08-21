export function Logo({ className = "h-6 w-auto" }: { className?: string }) {
  // Brex Atlas mark: a compass rosette + wordmark. Uses currentColor so it adapts to theme.
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Brex Atlas"
        className="h-full w-auto"
      >
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 4 L18.5 16 L16 28 L13.5 16 Z" fill="currentColor" />
        <path d="M4 16 L16 13.5 L28 16 L16 18.5 Z" fill="currentColor" opacity="0.55" />
      </svg>
      <span className="font-serif text-[1.05rem] font-semibold tracking-tight leading-none">
        Brex <span className="text-accent">Atlas</span>
      </span>
    </div>
  );
}
