export function TimelineSnapButton({ enabled, onToggle, className = '' }: { enabled: boolean; onToggle: () => void; className?: string }) {
  return <button className={"timeline-icon-btn timeline-snap-toggle " + className} type="button" title="吸附对齐" aria-label="吸附对齐"
    aria-pressed={enabled} onClick={onToggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13a9 9 0 0 1 18 0v7h-5v-7a4 4 0 0 0-8 0v7H3v-7ZM3 16h5m8 0h5" />
    </svg>
  </button>
}
