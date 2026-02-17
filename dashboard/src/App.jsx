import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'

// Page components
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import LocationRulesPage from './pages/LocationRules'
import CompanyRulesPage from './pages/CompanyRules'
import TeamMembersPage from './pages/TeamMembers'
import SettingsPage from './pages/Settings'

// Protected route wrapper — redirects to /login when not authenticated
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-light">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // For admin-only routes, check user metadata for role
  if (adminOnly) {
    const role = user.user_metadata?.role || user.app_metadata?.role
    if (role !== 'admin') {
      return <Navigate to="/" replace />
    }
  }

  return children
}

// Public route wrapper — redirects authenticated users away from login
function PublicRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-light">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public route */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        {/* Protected routes wrapped in Layout */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="locations" element={<LocationRulesPage />} />
          <Route path="companies" element={<CompanyRulesPage />} />
          <Route
            path="team"
            element={
              <ProtectedRoute adminOnly>
                <TeamMembersPage />
              </ProtectedRoute>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
