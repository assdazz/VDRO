export function VolumeIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 9h4l5-4v14l-5-4H4V9Z" strokeLinejoin="round"/>
    <path d={muted ? 'm16 9 5 6m0-6-5 6' : 'M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11'}
      strokeLinecap="round"/>
  </svg>
}
