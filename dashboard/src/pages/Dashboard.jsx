import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

function StatCard({ icon, value, label, loading: isLoading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-start gap-4">
      <div className="text-3xl">{icon}</div>
      <div>
        {isLoading ? (
          <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-1" />
        ) : (
          <p className="text-3xl font-bold text-navy">{value}</p>
        )}
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    locationRules: 0,
    companyRules: 0,
    teamMembers: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    setLoading(true)
    setError('')
    try {
      const [locationRes, companyRes, teamRes] = await Promise.all([
        supabase
          .from('location_rules')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('company_rules')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('team_members')
          .select('id', { count: 'exact', head: true }),
      ])

      if (locationRes.error) throw locationRes.error
      if (companyRes.error) throw companyRes.error
      if (teamRes.error) throw teamRes.error

      setStats({
        locationRules: locationRes.count ?? 0,
        companyRules: companyRes.count ?? 0,
        teamMembers: teamRes.count ?? 0,
      })
    } catch (err) {
      setError('Failed to load dashboard statistics. Please try again.')
      console.error('Dashboard fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Welcome back{user?.email ? `, ${user.email}` : ''}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg bg-red/10 border border-red/20 px-4 py-3 text-sm text-red flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchStats}
            className="text-sm font-medium underline hover:no-underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard
          icon="📍"
          value={stats.locationRules}
          label="Active Location Rules"
          loading={loading}
        />
        <StatCard
          icon="🏢"
          value={stats.companyRules}
          label="Active Company Rules"
          loading={loading}
        />
        <StatCard
          icon="👥"
          value={stats.teamMembers}
          label="Team Members"
          loading={loading}
        />
        <StatCard
          icon="🧩"
          value="Active"
          label="Extension Status"
          loading={false}
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-navy mb-4">
          Recent Activity
        </h2>
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No recent activity</p>
        </div>
      </div>
    </div>
  )
}
