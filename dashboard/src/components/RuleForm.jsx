import { useState, useEffect } from 'react'
import AlertPreview from './AlertPreview'

const SEVERITY_OPTIONS = [
  { value: 'red', label: 'Red (Block)' },
  { value: 'amber', label: 'Amber (Warning)' },
]

export default function RuleForm({
  type = 'location',
  initialValues = null,
  onSubmit,
  onCancel,
}) {
  const [pattern, setPattern] = useState('')
  const [severity, setSeverity] = useState('red')
  const [message, setMessage] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const isEditing = !!initialValues

  useEffect(() => {
    if (initialValues) {
      setPattern(initialValues.pattern || '')
      setSeverity(initialValues.severity || 'red')
      setMessage(initialValues.message || '')
      if (type === 'company' && initialValues.expires_at) {
        // Format date for input (YYYY-MM-DD)
        const date = new Date(initialValues.expires_at)
        setExpiresAt(date.toISOString().split('T')[0])
      }
    }
  }, [initialValues, type])

  const validate = () => {
    const errs = {}
    if (!pattern.trim()) {
      errs.pattern = 'Pattern is required.'
    }
    if (!severity) {
      errs.severity = 'Severity is required.'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    try {
      const values = {
        pattern: pattern.trim(),
        severity,
        message: message.trim(),
      }
      if (type === 'company') {
        values.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
      }
      await onSubmit(values)
    } catch {
      // Parent handles errors
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Pattern */}
      <div>
        <label
          htmlFor="rule-pattern"
          className="block text-sm font-medium text-dark mb-1.5"
        >
          Pattern <span className="text-red">*</span>
        </label>
        <input
          id="rule-pattern"
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={
            type === 'location'
              ? 'e.g. github.com/risky-org/*'
              : 'e.g. Acme Corp'
          }
          className={`w-full rounded-lg border px-4 py-2.5 text-sm text-dark placeholder-gray-400 focus:outline-none focus:ring-2 transition ${
            errors.pattern
              ? 'border-red focus:border-red focus:ring-red/20'
              : 'border-gray-300 focus:border-teal focus:ring-teal/20'
          }`}
        />
        {errors.pattern && (
          <p className="mt-1 text-xs text-red">{errors.pattern}</p>
        )}
      </div>

      {/* Severity */}
      <div>
        <label
          htmlFor="rule-severity"
          className="block text-sm font-medium text-dark mb-1.5"
        >
          Severity <span className="text-red">*</span>
        </label>
        <select
          id="rule-severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className={`w-full rounded-lg border px-4 py-2.5 text-sm text-dark focus:outline-none focus:ring-2 transition ${
            errors.severity
              ? 'border-red focus:border-red focus:ring-red/20'
              : 'border-gray-300 focus:border-teal focus:ring-teal/20'
          }`}
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.severity && (
          <p className="mt-1 text-xs text-red">{errors.severity}</p>
        )}
      </div>

      {/* Message */}
      <div>
        <label
          htmlFor="rule-message"
          className="block text-sm font-medium text-dark mb-1.5"
        >
          Message
        </label>
        <textarea
          id="rule-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message shown to the user when this rule triggers"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark placeholder-gray-400 focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition resize-none"
        />
      </div>

      {/* Expires At (company rules only) */}
      {type === 'company' && (
        <div>
          <label
            htmlFor="rule-expires"
            className="block text-sm font-medium text-dark mb-1.5"
          >
            Expires At{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="rule-expires"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
          />
        </div>
      )}

      {/* Alert preview */}
      <AlertPreview severity={severity} message={message} />

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          {submitting
            ? 'Saving...'
            : isEditing
              ? 'Update Rule'
              : 'Add Rule'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200 focus:outline-none transition"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
