// User Model with OAuth Support
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
      select: false, // Don't include in queries by default
    },
    name: {
      type: String,
      required: true,
    },
    avatar: String,
    role: {
      type: String,
      enum: ["admin", "user", "team-owner"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: String,
    verificationTokenExpires: Date,
    // OAuth Fields
    oauth: {
      google: {
        id: String,
        email: String,
        picture: String,
        refreshToken: String,
      },
      github: {
        id: String,
        login: String,
        avatar_url: String,
        accessToken: String,
      },
    },
    // Account settings
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: String,
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
  },
  { timestamps: true }
)

// Index for email
userSchema.index({ email: 1 })
userSchema.index({ "oauth.google.id": 1 })
userSchema.index({ "oauth.github.id": 1 })

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next()
  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password)
}

// Method to check if account is locked
userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now()
}

// Method to increment login attempts
userSchema.methods.incLoginAttempts = async function () {
  // If previous lock has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    })
  }
  // Otherwise inc attempts
  const updates = { $inc: { loginAttempts: 1 } }
  // Lock the account if at max attempts
  if (this.loginAttempts + 1 >= 5) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 } // 2 hours
  }
  return this.updateOne(updates)
}

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  })
}

// Static method - Find user by email (case-insensitive)
userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() })
}

// Static method - Find user by provider ID
userSchema.statics.findByGoogleId = function (googleId) {
  return this.findOne({ "oauth.google.id": googleId })
}

userSchema.statics.findByGithubId = function (githubId) {
  return this.findOne({ "oauth.github.id": githubId })
}

// Instance method - Check if provider is linked
userSchema.methods.hasProvider = function (provider) {
  if (provider === "google") {
    return !!(this.oauth?.google?.id)
  }
  if (provider === "github") {
    return !!(this.oauth?.github?.id)
  }
  return false
}

// Instance method - Get all linked providers
userSchema.methods.getLinkedProviders = function () {
  const providers = []
  if (this.password) providers.push("local")
  if (this.oauth?.google?.id) providers.push("google")
  if (this.oauth?.github?.id) providers.push("github")
  return providers
}

// Instance method - Link provider to existing user
userSchema.methods.linkProvider = function (provider, providerData) {
  if (provider === "google") {
    this.oauth.google = {
      id: providerData.id,
      email: providerData.email,
      picture: providerData.picture,
      refreshToken: providerData.refreshToken,
    }
  } else if (provider === "github") {
    this.oauth.github = {
      id: providerData.id,
      login: providerData.login,
      avatar_url: providerData.avatar_url,
      accessToken: providerData.accessToken,
    }
  }
}

module.exports = mongoose.models.User || mongoose.model("User", userSchema)
