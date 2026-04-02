import { SignIn } from '@clerk/clerk-react'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0d1117' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">The Price of <span style={{ color: '#f59e0b' }}>E.G.G.S.</span></h1>
          <p className="mt-2 text-sm" style={{ color: '#8b949e' }}>Professional grocery planning for event chefs</p>
        </div>
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
      </div>
    </div>
  )
}
