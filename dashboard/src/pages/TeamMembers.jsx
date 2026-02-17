import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

function RoleBadge({ role }) {
  const isAdmin = role === 'admin'
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        isAdmin
          ? 'bg-navy text-white'
          : 'bg-gray-200 text-gray-600'
      }`}
    >
      {role}
    </span>
  )
}

function InviteModal({ onClose, onInvite }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required.')
      return
    }

    setSubmitting(true)
    try {
      await onInvite({ email: email.trim(), role })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to send invite.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-navy">
            Invite Team Member
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-lg bg-red/10 border border-red/20 px-4 py-3 text-sm text-red">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="invite-email"
              className="block text-sm font-medium text-dark mb-1.5"
            >
              Email Address
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark placeholder-gray-400 focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
              disabled={submitting}
            />
          </div>

          <div>
            <label
              htmlFor="invite-role"
              className="block text-sm font-medium text-dark mb-1.5"
            >
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-dark focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none transition"
              disabled={submitting}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {submitting ? 'Sending...' : 'Send Invite'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200 focus:outline-none transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TeamMembers() {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState(null)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchErr } = await supabase
        .from('team_members')
        .select('*')
        .order('created_at', { ascending: true })

      if (fetchErr) throw fetchErr
      setMembers(data || [])

      // Determine current user's role
      const me = (data || []).find(
        (m) => m.user_id === user?.id || m.email === user?.email,
      )
      setCurrentUserRole(me?.role || null)
    } catch (err) {
      setError('Failed to load team members. Please try again.')
      console.error('TeamMembers fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const isAdmin = currentUserRole === 'admin'

  const handleInvite = async ({ email, role }) => {
    try {
      const { error: insertErr } = await supabase
        .from('team_members')
        .insert([{ email, role }])

      if (insertErr) throw insertErr
      await fetchMembers()
    } catch (err) {
      console.error('Invite error:', err)
      throw err
    }
  }

  const handleChangeRole = async (memberId, newRole) => {
    setError('')
    setUpdatingId(memberId)

    const original = members.find((m) => m.id === memberId)
    // Optimistic
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
    )

    try {
      const { error: updateErr } = await supabase
        .from('team_members')
        .update({ role: newRole })
        .eq('id', memberId)

      if (updateErr) throw updateErr
    } catch (err) {
      // Rollback
      if (original) {
        setMembers((prev) =>
          prev.map((m) => (m.id === memberId ? original : m)),
        )
      }
      setError('Failed to update role. Please try again.')
      console.error('Change role error:', err)
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRemove = async (memberId) => {
    if (confirmRemoveId !== memberId) {
      setConfirmRemoveId(memberId)
      return
    }

    setError('')
    setUpdatingId(memberId)
    const removed = members.find((m) => m.id === memberId)

    // Optimistic
    setMembers((prev) => prev.filter((m) => m.id !== memberId))
    setConfirmRemoveId(null)

    try {
      const { error: deleteErr } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId)

      if (deleteErr) throw deleteErr
    } catch (err) {
      // Rollback
      if (removed) {
        setMembers((prev) => [...prev, removed])
      }
      setError('Failed to remove member. Please try again.')
      console.error('Remove member error:', err)
    } finally {
      setUpdatingId(null)
    }
  }

  // Access denied for non-admins
  if (!loading && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-navy mb-2">Access Denied</h2>
          <p className="text-gray-500 text-sm">
            Only administrators can manage team members.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Team Members</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage who has access to your SourceFence rules
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark transition"
        >
          Invite Member
        </button>
      </div>

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

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="animate-pulse">
            <div className="h-12 bg-gray-50 border-b border-gray-100" />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-6 py-4 border-b border-gray-50"
              >
                <div className="h-4 w-1/3 bg-gray-200 rounded" />
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">
            No team members found. Invite your first member to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name / Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, idx) => {
                  const isCurrentUser =
                    member.user_id === user?.id ||
                    member.email === user?.email
                  return (
                    <tr
                      key={member.id}
                      className={`border-b border-gray-50 hover:bg-light/50 transition-colors ${
                        idx % 2 === 1 ? 'bg-gray-50/30' : ''
                      }`}
                    >
                      <td className="px-6 py-3.5">
                        <div>
                          <p className="font-medium text-dark">
                            {member.name || member.email}
                            {isCurrentUser && (
                              <span className="ml-2 text-xs text-gray-400">
                                (you)
                              </span>
                            )}
                          </p>
                          {member.name && (
                            <p className="text-xs text-gray-400">
                              {member.email}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <RoleBadge role={member.role} />
                      </td>
                      <td className="px-6 py-3.5 text-gray-500">
                        {member.created_at
                          ? new Date(member.created_at).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        {!isCurrentUser && (
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={member.role}
                              onChange={(e) =>
                                handleChangeRole(member.id, e.target.value)
                              }
                              disabled={updatingId === member.id}
                              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:border-teal focus:outline-none disabled:opacity-50"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              onClick={() => handleRemove(member.id)}
                              disabled={updatingId === member.id}
                              className={`text-xs font-medium px-2 py-1 rounded transition ${
                                confirmRemoveId === member.id
                                  ? 'text-white bg-red hover:bg-red/90'
                                  : 'text-red hover:text-red/80 hover:bg-red/5'
                              } disabled:opacity-50`}
                            >
                              {confirmRemoveId === member.id
                                ? 'Confirm'
                                : 'Remove'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvite={handleInvite}
        />
      )}
    </div>
  )
}
