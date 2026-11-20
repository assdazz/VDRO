type WaveformZoomControlsProps = {
  className?: string
  factor: number
  canZoomIn: boolean
  canZoomOut: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}

export function WaveformZoomControls({
  className, factor, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset,
}: WaveformZoomControlsProps) {
  const buttons = [
    { icon: 'minus', label: '缩小', disabled: !canZoomOut, onClick: onZoomOut },
    { icon: 'plus', label: '放大', disabled: !canZoomIn, onClick: onZoomIn },
    { icon: 'reset', label: '重置缩放', disabled: !canZoomOut, onClick: onReset },
  ]

  return (
    <div className={className ? `waveform-zoom-controls ${className}` : 'waveform-zoom-controls'}
      role="group" aria-label="波形缩放">
      {buttons.map(({ icon, label, disabled, onClick }) => (
        <button key={icon} className="timeline-icon-btn" type="button" title={label} aria-label={label} data-zoom={icon}
          disabled={disabled} onClick={onClick}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {icon === 'reset' ? (
              <>
                <path d="M20 11a8 8 0 0 0-15.2-3M20 6v5h-5" />
                <path d="M4 13a8 8 0 0 0 15.2 3M4 18v-5h5" />
              </>
            ) : (
              <>
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m15.2 15.2 4.8 4.8M7.5 10.5h6" />
                {icon === 'plus' && <path d="M10.5 7.5v6" />}
              </>
            )}
          </svg>
        </button>
      ))}
      <output className="waveform-zoom-factor" aria-label="当前波形缩放倍率">{factor.toFixed(1)}×</output>
    </div>
  )
}
