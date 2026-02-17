import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Papa from 'papaparse'

function Section({ title, description, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
      <h2 className="text-lg font-semibold text-navy mb-1">{title}</h2>
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      {children}
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [companyName, setCompanyName] = useState('')
  const [domain, setDomain] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingCompany, setSavingCompany] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [exportingLocation, setExportingLocation] = useState(false)
  const [exportingCompany, setExportingCompany] = useState(false)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchErr } = await supabase
        .from('team_settings')
        .select('*')
        .limit(1)
        .maybeSingle()

      if (fetchErr) throw fetchErr

      if (data) {
        setCompanyName(data.company_name || '')
        setDomain(data.domain || '')
        setInviteCode(data.invite_code || '')
      }
    } catch (err) {
      setError('Failed to load settings. Please try again.')
      console.error('Settings fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const showSuccess = (msg) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  const handleSaveCompany = async (e) => {
    e.preventDefault()
    setError('')
    setSavingCompany(true)
    try {
      const { error: updateErr } = await supabase
        .from('team_settings')
        .update({ company_name: companyName.trim() })
        .eq('domain', domain)

      if (updateErr) throw updateErr
      showSuccess('Company name updated successfully.')
    } catch (err) {
      setError('Failed to save company name. Please try again.')
      console.error('Save company error:', err)
    } finally {
      setSavingCompany(false)
    }
  }

  const handleRegenerateCode = async () => {
    setError('')
    setRegenerating(true)
    try {
      // Generate a random 8-character code
      const newCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map((b) => b.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 8)
        .toUpperCase()

      const { error: updateErr } = await supabase
        .from('team_settings')
        .update({ invite_code: newCode })
        .eq('domain', domain)

      if (updateErr) throw updateErr
      setInviteCode(newCode)
      showSuccess('Invite code regenerated successfully.')
    } catch (err) {
      setError('Failed to regenerate invite code. Please try again.')
      console.error('Regenerate code error:', err)
    } finally {
      setRegenerating(false)
    }
  }

  const downloadCSV = (filename, csvString) => {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleExportLocation = async () => {
    setError('')
    setExportingLocation(true)
    try {
      const { data, error: fetchErr } = await supabase
        .from('location_rules')
        .select('pattern, severity, message, is_active')
        .order('created_at', { ascending: false })

      if (fetchErr) throw fetchErr

      const csv = Papa.unparse(data || [])
      downloadCSV('location-rules.csv', csv)
      showSuccess('Location rules exported successfully.')
    } catch (err) {
      setError('Failed to export location rules. Please try again.')
      console.error('Export location error:', err)
    } finally {
      setExportingLocation(false)
    }
  }

  const handleExportCompany = async () => {
    setError('')
    setExportingCompany(true)
    try {
      const { data, error: fetchErr } = await supabase
        .from('company_rules')
        .select('pattern, severity, message, is_active, expires_at')
        .order('created_at', { ascending: false })

      if (fetchErr) throw fetchErr

      const csv = Papa.unparse(data || [])
      downloadCSV('company-rules.csv', csv)
      showSuccess('Company rules exported successfully.')
    } catch (err) {
      setError('Failed to export company rules. Please try again.')
      console.error('Export company error:', err)
    } finally {
      setExportingCompany(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy mb-6">Settings</h1>
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 animate-pulse"
            >
              <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
              <div className="h-4 w-64 bg-gray-200 rounded mb-3" />
              <div className="h-10 w-full bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy mb-6">Settings</h1>

      {/* Success */}
      {success && (
        <div className="mb-6 rounded-lg bg-green/10 border border-green/20 px-4 py-3 text-sm text-green">
          {success}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg bg-red/10 border border-red/20 px-4 py-3 text-sm text-red flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="text-red/60 hover:text-red ml-4 text-lg leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* Company Info */}
      <Section
        title="Company Information"
        description="Basic information about your organization."
      >
        <form onSubmit={handleSaveCompany} className="space-y-4">
          <div>
            <label
              htmlFor="company-name"
              className="block text-sm font-medium text-dark mb-1.5"
            >
              Company Name
            </label>
            <input
              id="company-name"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1.5">
              Domain
            </label>
            <input
              type="text"
              value={domain}
              readOnly
              className="w-full max-w-md rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">
              Domain cannot be changed.
            </p>
          </div>

          <button
            type="submit"
            disabled={savingCompany}
            className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {savingCompany ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </Section>

      {/* Invite Code */}
      <Section
        title="Invite Code"
        description="Share this code with team members so they can join your organization."
      >
        <div className="flex items-center gap-4 max-w-md">
          <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 font-mono text-sm text-dark tracking-wider select-all">
            {inviteCode || 'No invite code generated'}
          </div>
          <button
            onClick={handleRegenerateCode}
            disabled={regenerating}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 focus:outline-none transition disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Regenerating will invalidate the previous code.
        </p>
      </Section>

      {/* Export */}
      <Section
        title="Export Data"
        description="Download your rules as CSV files for backup or migration."
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportLocation}
            disabled={exportingLocation}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 focus:outline-none transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportingLocation
              ? 'Exporting...'
              : 'Export Location Rules as CSV'}
          </button>
          <button
            onClick={handleExportCompany}
            disabled={exportingCompany}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 focus:outline-none transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportingCompany
              ? 'Exporting...'
              : 'Export Company Rules as CSV'}
          </button>
        </div>
      </Section>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl shadow-sm border border-red/20 p-6">
        <h2 className="text-lg font-semibold text-red mb-1">Danger Zone</h2>
        <p className="text-sm text-gray-500 mb-4">
          Irreversible and destructive actions.
        </p>
        <button
          disabled
          className="rounded-lg border border-red/30 px-4 py-2.5 text-sm font-medium text-red/50 cursor-not-allowed"
        >
          Delete Account (Coming Soon)
        </button>
      </div>
    </div>
  )
}
