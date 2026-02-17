import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('password') // 'password' | 'magic'

  // Redirect if already logged in
  if (user) {
    navigate('/', { replace: true })
    return null
  }

  const handlePasswordLogin = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authError) throw authError
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Failed to sign in. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleMagicLink = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }

    setLoading(true)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
      })
      if (otpError) throw otpError
      setMessage('Check your email for a magic link to sign in.')
    } catch (err) {
      setError(err.message || 'Failed to send magic link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-light flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="bg-navy rounded-t-xl px-8 py-6 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            SourceFence
          </h1>
          <p className="text-teal text-sm mt-1 font-medium">
            Admin Dashboard
          </p>
        </div>

        {/* Card body */}
        <div className="bg-white rounded-b-xl shadow-lg px-8 py-8">
          <h2 className="text-lg font-semibold text-dark mb-6 text-center">
            {mode === 'password' ? 'Sign in to your account' : 'Sign in with magic link'}
          </h2>

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg bg-red/10 border border-red/20 px-4 py-3 text-sm text-red">
              {error}
            </div>
          )}

          {/* Success message */}
          {message && (
            <div className="mb-4 rounded-lg bg-green/10 border border-green/20 px-4 py-3 text-sm text-green">
              {message}
            </div>
          )}

          <form onSubmit={mode === 'password' ? handlePasswordLogin : handleMagicLink}>
            {/* Email */}
            <div className="mb-4">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-dark mb-1.5"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark placeholder-gray-400 focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
                disabled={loading}
              />
            </div>

            {/* Password (only in password mode) */}
            {mode === 'password' && (
              <div className="mb-6">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-dark mb-1.5"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark placeholder-gray-400 focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
                  disabled={loading}
                />
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {loading
                ? 'Please wait...'
                : mode === 'password'
                  ? 'Sign In'
                  : 'Send Magic Link'}
            </button>
          </form>

          {/* Mode toggle */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'password' ? 'magic' : 'password')
                setError('')
                setMessage('')
              }}
              className="text-sm text-teal hover:text-teal-dark font-medium transition"
            >
              {mode === 'password'
                ? 'Sign in with magic link instead'
                : 'Sign in with password instead'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          SourceFence &mdash; Protecting your code from risky sources
        </p>
      </div>
    </div>
  )
}
