import { useMemo } from 'react'

const SEVERITY_CONFIG = {
  red: {
    bg: 'bg-red',
    border: 'border-red',
    text: 'text-white',
    label: 'BLOCKED',
    icon: '!!',
  },
  amber: {
    bg: 'bg-orange',
    border: 'border-orange',
    text: 'text-white',
    label: 'WARNING',
    icon: '!',
  },
  green: {
    bg: 'bg-green',
    border: 'border-green',
    text: 'text-white',
    label: 'SAFE',
    icon: '',
  },
}

export default function AlertPreview({ severity = 'red', message = '' }) {
  const config = useMemo(
    () => SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.red,
    [severity],
  )

  const displayMessage =
    message.trim() || 'This is a preview of the extension banner.'

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        Extension Banner Preview
      </p>
      <div
        className={`${config.bg} ${config.text} rounded-lg px-4 py-3 flex items-center gap-3 shadow-sm text-sm`}
      >
        {/* Icon badge */}
        {config.icon && (
          <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-xs font-bold">
            {config.icon}
          </span>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className="font-semibold mr-2">{config.label}:</span>
          <span className="opacity-95">{displayMessage}</span>
        </div>

        {/* Dismiss X */}
        <span className="flex-shrink-0 opacity-60 cursor-default text-lg leading-none">
          &times;
        </span>
      </div>
    </div>
  )
}
