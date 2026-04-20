const jwt = require("jsonwebtoken")
const User = require("../models/User")
const AuditLog = require("../models/AuditLog")
const crypto = require("crypto")
const emailService = require("../utils/emailService")

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" })
}

const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" })
}

// Local Authentication - Signup
exports.signup = async (req, res) => {
  try {
    const { email, password, confirmPassword, name } = req.body

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" })
    }

    // Check if user already exists (case-insensitive)
    const existingUser = await User.findByEmail(email)
    if (existingUser) {
      return res.status(409).json({ 
        error: "Email already registered. Please login or use social login to connect your accounts." 
      })
    }

    // Create new user with local provider
    const user = new User({
      email: email.toLowerCase(),
      password,
      name,
      emailVerified: false,
      verificationToken: crypto.randomBytes(20).toString("hex"),
      oauth: {
        google: {},
        github: {},
      },
    })

    await user.save()

    // Generate tokens
    const token = generateToken(user._id)
    const refreshToken = generateRefreshToken(user._id)

    // Audit log
    await AuditLog.create({
      userId: user._id,
      action: "USER_SIGNED_UP",
      resourceType: "User",
      resourceId: user._id,
      metadata: { email, name },
    })

    res.status(201).json({
      message: "Signup successful",
      token,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Local Authentication - Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" })
    }

    // Find user and select password field
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password")

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({ error: "Account is locked. Try again later." })
    }

    // Check if user has a password (might be OAuth-only user)
    if (!user.password) {
      return res.status(401).json({ error: "This account uses OAuth. Please sign in with GitHub or Google." })
    }

    // Compare passwords
    const isValidPassword = await user.comparePassword(password)

    if (!isValidPassword) {
      await user.incLoginAttempts()
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts()

    // Update last login
    user.lastLogin = new Date()
    await user.save()

    // Generate tokens
    const token = generateToken(user._id)
    const refreshToken = generateRefreshToken(user._id)

    // Audit log
    await AuditLog.create({
      userId: user._id,
      action: "USER_LOGGED_IN",
      resourceType: "User",
      resourceId: user._id,
      metadata: { email },
    })

    res.json({
      message: "Login successful",
      token,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Logout
exports.logout = async (req, res) => {
  try {
    const { userId } = req

    await AuditLog.create({
      userId,
      action: "USER_LOGGED_OUT",
      resourceType: "User",
      resourceId: userId,
      metadata: {},
    })

    res.json({ message: "Logout successful" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" })
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId)

    if (!user) {
      return res.status(401).json({ error: "User not found" })
    }

    const newToken = generateToken(user._id)

    res.json({ token: newToken })
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" })
  }
}

// Google OAuth Callback
exports.googleCallback = async (req, res) => {
  try {
    const { profile } = req.user
    const { id, displayName, emails, photos } = profile

    const googleEmail = emails?.[0]?.value
    if (!googleEmail) {
      throw new Error("Google account does not have an email address")
    }

    let user = await User.findByGoogleId(id)
    let isNewUser = false
    let isLinked = false

    if (!user) {
      // Google ID not found, check if user exists by email
      user = await User.findByEmail(googleEmail)
      
      if (!user) {
        // Create new user with Google provider
        isNewUser = true
        user = new User({
          email: googleEmail,
          name: displayName,
          avatar: photos?.[0]?.value,
          emailVerified: true,
          oauth: {
            google: {
              id,
              email: googleEmail,
              picture: photos?.[0]?.value,
            },
            github: {},
          },
        })
        await user.save()

        console.log("[v0] New user created via Google:", user._id)

        await AuditLog.create({
          userId: user._id,
          action: "USER_SIGNED_UP_GOOGLE",
          resourceType: "User",
          resourceId: user._id,
          metadata: { email: googleEmail, name: displayName },
        })
      } else {
        // Link Google to existing user with matching email
        isLinked = true
        user.linkProvider("google", {
          id,
          email: googleEmail,
          picture: photos?.[0]?.value,
        })
        user.lastLogin = new Date()
        user.avatar = user.avatar || photos?.[0]?.value // Update avatar if not set
        await user.save()

        console.log("[v0] Google linked to existing user:", user._id)

        await AuditLog.create({
          userId: user._id,
          action: "USER_LINKED_GOOGLE",
          resourceType: "User",
          resourceId: user._id,
          metadata: { email: googleEmail },
        })
      }
    } else {
      // Google ID already exists, update last login
      user.lastLogin = new Date()
      await user.save()

      console.log("[v0] Google login for existing user:", user._id)

      await AuditLog.create({
        userId: user._id,
        action: "USER_LOGGED_IN_GOOGLE",
        resourceType: "User",
        resourceId: user._id,
        metadata: { email: googleEmail },
      })
    }

    const token = generateToken(user._id)
    const refreshToken = generateRefreshToken(user._id)

    // Redirect to frontend with tokens in URL
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000"
    const redirectUrl = new URL(`${clientUrl}/login/auth-callback`)
    redirectUrl.searchParams.append("token", token)
    redirectUrl.searchParams.append("refreshToken", refreshToken)
    redirectUrl.searchParams.append("userId", user._id)
    redirectUrl.searchParams.append("email", user.email)
    redirectUrl.searchParams.append("name", user.name)
    redirectUrl.searchParams.append("avatar", user.avatar || "")
    redirectUrl.searchParams.append("isNew", isNewUser ? "true" : "false")
    redirectUrl.searchParams.append("isLinked", isLinked ? "true" : "false")

    res.redirect(redirectUrl.toString())
  } catch (error) {
    console.error("[v0] Google callback error:", error)
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000"
    res.redirect(`${clientUrl}/login/error?message=${encodeURIComponent(error.message)}`)
  }
}

// GitHub OAuth Callback
exports.githubCallback = async (req, res) => {
  try {
    const { profile, accessToken } = req.user
    const { id, displayName, username, photos, emails } = profile

    let user = await User.findByGithubId(id)
    let isNewUser = false
    let isLinked = false

    if (!user) {
      const githubEmail = emails?.[0]?.value
      
      // Check if user exists by email (if GitHub provided one)
      if (githubEmail) {
        user = await User.findByEmail(githubEmail)
      }
      
      if (!user) {
        // Create new user with GitHub provider
        isNewUser = true
        user = new User({
          email: githubEmail || `${username}@github.local`,
          name: displayName || username,
          avatar: photos?.[0]?.value,
          emailVerified: !!githubEmail,
          oauth: {
            github: {
              id,
              login: username,
              avatar_url: photos?.[0]?.value,
              accessToken,
            },
            google: {},
          },
        })
        await user.save()

        console.log("[v0] New user created via GitHub:", user._id)

        await AuditLog.create({
          userId: user._id,
          action: "USER_SIGNED_UP_GITHUB",
          resourceType: "User",
          resourceId: user._id,
          metadata: { username, name: displayName },
        })
      } else {
        // Link GitHub to existing user with matching email
        isLinked = true
        user.linkProvider("github", {
          id,
          login: username,
          avatar_url: photos?.[0]?.value,
          accessToken,
        })
        user.lastLogin = new Date()
        user.avatar = user.avatar || photos?.[0]?.value // Update avatar if not set
        await user.save()

        console.log("[v0] GitHub linked to existing user:", user._id)

        await AuditLog.create({
          userId: user._id,
          action: "USER_LINKED_GITHUB",
          resourceType: "User",
          resourceId: user._id,
          metadata: { username },
        })
      }
    } else {
      // GitHub ID already exists, update last login
      user.lastLogin = new Date()
      // Update GitHub access token
      if (user.oauth?.github) {
        user.oauth.github.accessToken = accessToken
      }
      await user.save()

      console.log("[v0] GitHub login for existing user:", user._id)

      await AuditLog.create({
        userId: user._id,
        action: "USER_LOGGED_IN_GITHUB",
        resourceType: "User",
        resourceId: user._id,
        metadata: { username },
      })
    }

    // Save GitHub integration with access token for repository access
    const GitHubIntegration = require("../models/GitHubIntegration")
    console.log('[v0] Saving GitHub integration for user:', user._id)
    
    await GitHubIntegration.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        githubUsername: username,
        accessToken: accessToken,
        connectedAt: new Date(),
      },
      { upsert: true, new: true }
    )
    
    console.log('[v0] GitHub integration saved successfully')

    const token = generateToken(user._id)
    const refreshToken = generateRefreshToken(user._id)

    // Try to get return URL from multiple sources
    let returnUrl = null;
    
    // Check 1: URL query parameter (state)
    if (req.query.state) {
      try {
        const stateData = JSON.parse(Buffer.from(decodeURIComponent(req.query.state), 'base64').toString());
        returnUrl = stateData.returnUrl;
        console.log('[v0] Got returnUrl from state parameter:', returnUrl);
      } catch (e) {
        console.log('[v0] Could not parse state parameter:', e.message);
      }
    }

    // Check 2: Session variable
    if (!returnUrl && req.session?.githubReturnUrl) {
      returnUrl = req.session.githubReturnUrl;
      console.log('[v0] Got returnUrl from session:', returnUrl);
      delete req.session.githubReturnUrl;
    }

    // Check 3: Referer header
    if (!returnUrl && req.get('referer')) {
      returnUrl = req.get('referer');
      console.log('[v0] Got returnUrl from referer:', returnUrl);
    }

    // If we have a return URL, redirect there with tokens
    if (returnUrl && (returnUrl.includes('localhost') || returnUrl.includes('http'))) {
      try {
        console.log('[v0] Redirecting to returnUrl with tokens');
        const redirectUrl = new URL(returnUrl);
        redirectUrl.searchParams.append('token', token);
        redirectUrl.searchParams.append('refreshToken', refreshToken);
        redirectUrl.searchParams.append('github-connected', 'true');
        return res.redirect(redirectUrl.toString());
      } catch (e) {
        console.error('[v0] Invalid return URL:', e.message);
      }
    }

    // Fallback: redirect to standard auth-callback
    console.log('[v0] Using standard auth-callback redirect');
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000"
    const redirectUrl = new URL(`${clientUrl}/login/auth-callback`)
    redirectUrl.searchParams.append("token", token)
    redirectUrl.searchParams.append("refreshToken", refreshToken)
    redirectUrl.searchParams.append("userId", user._id)
    redirectUrl.searchParams.append("email", user.email)
    redirectUrl.searchParams.append("name", user.name)
    redirectUrl.searchParams.append("avatar", user.avatar || "")
    redirectUrl.searchParams.append("isNew", isNewUser ? "true" : "false")
    redirectUrl.searchParams.append("isLinked", isLinked ? "true" : "false")
    redirectUrl.searchParams.append("provider", "github")

    res.redirect(redirectUrl.toString())
  } catch (error) {
    console.error('[v0] GitHub callback error:', error)
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000"
    res.redirect(`${clientUrl}/login/error?message=${encodeURIComponent(error.message)}`)
  }
}

// Get Current User
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.userId)

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      emailVerified: user.emailVerified,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Update Profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body
    const { userId } = req

    const user = await User.findByIdAndUpdate(
      userId,
      { name, avatar },
      { new: true }
    )

    await AuditLog.create({
      userId,
      action: "USER_PROFILE_UPDATED",
      resourceType: "User",
      resourceId: userId,
      metadata: { name, avatar },
    })

    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body
    const { userId } = req

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" })
    }

    const user = await User.findById(userId).select("+password")

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verify current password
    const isValidPassword = await user.comparePassword(currentPassword)

    if (!isValidPassword) {
      return res.status(401).json({ error: "Current password is incorrect" })
    }

    // Update password
    user.password = newPassword
    await user.save()

    await AuditLog.create({
      userId,
      action: "USER_PASSWORD_CHANGED",
      resourceType: "User",
      resourceId: userId,
      metadata: {},
    })

    res.json({ message: "Password changed successfully" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    const user = await User.findOne({ email: email.toLowerCase() })

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex")
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex")

    user.verificationToken = resetTokenHash
    user.verificationTokenExpires = Date.now() + 60 * 60 * 1000 // 1 hour
    await user.save()

    await AuditLog.create({
      userId: user._id,
      action: "PASSWORD_RESET_REQUESTED",
      resourceType: "User",
      resourceId: user._id,
      metadata: { email },
    })

    // Send password reset email
    try {
      await emailService.sendPasswordResetEmail(user, resetToken)
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError)
      return res.status(500).json({ error: "Failed to send reset link. Please try again." })
    }

    res.json({
      message: "Password reset link sent to email",
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" })
    }

    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex")

    const user = await User.findOne({
      verificationToken: resetTokenHash,
      verificationTokenExpires: { $gt: Date.now() },
    })

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token" })
    }

    user.password = newPassword
    user.verificationToken = undefined
    user.verificationTokenExpires = undefined
    await user.save()

    await AuditLog.create({
      userId: user._id,
      action: "PASSWORD_RESET_COMPLETED",
      resourceType: "User",
      resourceId: user._id,
      metadata: {},
    })

    res.json({ message: "Password reset successful" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
