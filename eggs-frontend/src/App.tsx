import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import Dashboard from './pages/Dashboard'
import EventNew from './pages/EventNew'
import EventDetail from './pages/EventDetail'
import EventShop from './pages/EventShop'
import EventReconcile from './pages/EventReconcile'
import Onboarding from './pages/Onboarding'
import Settings from './pages/Settings'
import SignInPage from './pages/SignIn'
import SignUpPage from './pages/SignUp'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0d1117' }}>
      <div className="text-center">
        <div className="text-4xl font-bold mb-2" style={{ color: '#f59e0b' }}>E.G.G.S.</div>
        <div className="text-sm" style={{ color: '#8b949e' }}>Loading…</div>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return <LoadingScreen />
  if (!isSignedIn) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/events/new" element={<ProtectedRoute><EventNew /></ProtectedRoute>} />
        <Route path="/events/:id" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />
        <Route path="/events/:id/shop" element={<ProtectedRoute><EventShop /></ProtectedRoute>} />
        <Route path="/events/:id/reconcile" element={<ProtectedRoute><EventReconcile /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
