import { SignUp } from '@clerk/clerk-react'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0f172a' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">The Price of <span style={{ color: '#fbbf24' }}>E.G.G.S.</span></h1>
          <p className="mt-2 text-sm" style={{ color: '#94a3b8' }}>Professional grocery planning for event chefs</p>
        </div>
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/onboarding" />
      </div>
    </div>
  )
}
