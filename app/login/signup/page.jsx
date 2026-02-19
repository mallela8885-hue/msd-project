"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAppStore } from "@/store/use-app-store"
import apiClient from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Mail, Lock, Github, Chrome, Loader2, User } from "lucide-react"

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const { setUser, setIsAuthenticated } = useAppStore()

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    
    if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
      setError("Please fill in all fields")
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }
    
    setIsLoading(true)
    setError("")
    
    try {
      const response = await apiClient.signup(
        formData.email,
        formData.password,
        formData.confirmPassword,
        formData.name
      )
      
      // Redirect to login page after successful signup
      router.push("/login")
    } catch (err) {

  function handleGitHubSignup() {
    apiClient.startGitHubOAuth()
  }

  return (
    <main className="min-h-svh flex items-center justify-center p-6 bg-gradient-to-br from-background via-background to-primary/5">
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
      
      <div className="w-full max-w-md relative">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <Card className="shadow-2xl border-0 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-12 h-12 bg-gradient-to-r from-primary to-blue-600 rounded-xl flex items-center justify-center mb-4">
              <span className="text-white font-bold text-xl">⚡</span>
            </div>
            <h1 className="text-2xl font-bold">Create account</h1>
            <p className="text-muted-foreground">Join CloudDeck and start deploying</p>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-sm text-red-500">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button 
                type="button"
                variant="outline" 
                className="w-full"
                onClick={handleGitHubSignup}
                disabled={isLoading}
              >
                <Github className="size-4 mr-2" />
                GitHub
              </Button>
              <Button 
                type="button"
                variant="outline" 
                className="w-full"
                onClick={handleGoogleSignup}
                disabled={isLoading}
              >
                <Chrome className="size-4 mr-2" />
                Google
              </Button>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or sign up with email</span>
              </div>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium">Full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="text"
                    name="name"
                    placeholder="Enter your full name"
                    className="pl-10 h-11"
                    value={formData.name}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="email"
                    name="email"
                    placeholder="Enter your email"
                    className="pl-10 h-11"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="password"
                    name="password"
                    placeholder="Create a password"
                    className="pl-10 h-11"
                    value={formData.password}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">At least 6 characters</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="password"
                    name="confirmPassword"
                    placeholder="Confirm your password"
                    className="pl-10 h-11"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <input type="checkbox" id="terms" disabled={isLoading} required />
                <label htmlFor="terms" className="text-muted-foreground">
                  I agree to the{" "}
                  <Link href="/terms" className="text-primary hover:underline">
                    Terms of Service
                  </Link>
                </label>
              </div>

              <Button 
                type="submit" 
                className="w-full h-11 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 shadow-lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
