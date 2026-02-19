"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/store/use-app-store"
import { Eye, EyeOff, User, Mail, Lock, CheckCircle, XCircle, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [passwordStrength, setPasswordStrength] = useState(0)
  const [isFormValid, setIsFormValid] = useState(false)
  const { login } = useAppStore()
  const router = useRouter()

  // Password strength calculation
  const calculatePasswordStrength = (password) => {
    let strength = 0
    if (password.length >= 8) strength += 25
    if (/[a-z]/.test(password)) strength += 25
    if (/[A-Z]/.test(password)) strength += 25
    if (/[0-9]/.test(password)) strength += 12.5
    if (/[^A-Za-z0-9]/.test(password)) strength += 12.5
    return Math.min(strength, 100)
  }

  // Form validation
  const validateForm = () => {
    const newErrors = {}
    
    if (!formData.name.trim()) {
      newErrors.name = "Name is required"
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters"
    }

    if (!formData.email) {
      newErrors.email = "Email is required"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email"
    }

    if (!formData.password) {
      newErrors.password = "Password is required"
    } else if (formData.password.length < 8) {
      newErrors.password = "Password must be at least 8 characters"
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password"
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match"
    }

    setErrors(newErrors)
    const isValid = Object.keys(newErrors).length === 0 && 
                   formData.name && formData.email && formData.password && formData.confirmPassword
    setIsFormValid(isValid)
    return isValid
  }

  // Update form data
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    
    if (field === 'password') {
      setPasswordStrength(calculatePasswordStrength(value))
    }
  }

  // Validate on form changes
  useEffect(() => {
    if (Object.values(formData).some(value => value)) {
      validateForm()
    }
  }, [formData])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) return
    
    setLoading(true)
    
    // Simulate signup with realistic delay
        setTimeout(() => {
          // Redirect to login page after signup
          router.push("/login")
          setLoading(false)
        }, 1500)
  }

  const getPasswordStrengthColor = () => {
    if (passwordStrength < 25) return "bg-red-500"
    if (passwordStrength < 50) return "bg-orange-500"
    if (passwordStrength < 75) return "bg-yellow-500"
    return "bg-green-500"
  }

  const getPasswordStrengthText = () => {
    if (passwordStrength < 25) return "Weak"
    if (passwordStrength < 50) return "Fair"
    if (passwordStrength < 75) return "Good"
    return "Strong"
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-400/20 to-purple-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-green-400/20 to-blue-600/20 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 shadow-2xl">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Join CloudDeck
            </CardTitle>
            <p className="text-muted-foreground mt-2">Create your account and start deploying</p>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name Field */}
            <div className="space-y-2">
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Full Name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className={cn(
                    "pl-10 h-12 transition-all duration-200",
                    errors.name ? "border-red-500 focus-visible:ring-red-500" : "focus-visible:ring-blue-500"
                  )}
                />
                {formData.name && !errors.name && (
                  <CheckCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-500 w-4 h-4" />
                )}
              </div>
              {errors.name && (
                <p className="text-red-500 text-sm flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {errors.name}
                </p>
              )}
            </div>

            {/* Email Field */}
            <div className="space-y-2">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type="email"
                  placeholder="Email Address"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={cn(
                    "pl-10 h-12 transition-all duration-200",
                    errors.email ? "border-red-500 focus-visible:ring-red-500" : "focus-visible:ring-blue-500"
                  )}
                />
                {formData.email && !errors.email && (
                  <CheckCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-500 w-4 h-4" />
                )}
              </div>
              {errors.email && (
                <p className="text-red-500 text-sm flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  className={cn(
                    "pl-10 pr-10 h-12 transition-all duration-200",
                    errors.password ? "border-red-500 focus-visible:ring-red-500" : "focus-visible:ring-blue-500"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              
              {/* Password Strength Indicator */}
              {formData.password && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Password strength</span>
                    <span className={cn(
                      "font-medium",
                      passwordStrength < 25 ? "text-red-500" :
                      passwordStrength < 50 ? "text-orange-500" :
                      passwordStrength < 75 ? "text-yellow-500" : 
                      "text-green-500"
                    )}>
                    {getPasswordStrengthText()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className={cn("h-2 rounded-full transition-all duration-300", getPasswordStrengthColor())}
                      style={{ width: `${passwordStrength}%` }}
                    />
                  </div>
                </div>
              )}
              
              {errors.password && (
                <p className="text-red-500 text-sm flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {errors.password}
                </p>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm Password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  className={cn(
                    "pl-10 pr-10 h-12 transition-all duration-200",
                    errors.confirmPassword ? "border-red-500 focus-visible:ring-red-500" : "focus-visible:ring-blue-500"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {formData.confirmPassword && !errors.confirmPassword && formData.password === formData.confirmPassword && (
                  <CheckCircle className="absolute right-10 top-1/2 transform -translate-y-1/2 text-green-500 w-4 h-4" />
                )}
              </div>
              {errors.confirmPassword && (
                <p className="text-red-500 text-sm flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <Button 
              type="submit" 
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold transition-all duration-200 disabled:opacity-50"
              disabled={!isFormValid || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>

          {/* Login Link */}
          <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link 
                href="/login" 
                className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}