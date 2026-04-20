"use client"

/**
 * Secure Token Management Service
 * Handles JWT token storage, retrieval, and validation
 * Uses secure patterns to prevent XSS attacks
 */

class TokenService {
  constructor() {
    this.accessTokenKey = process.env.NEXT_PUBLIC_AUTH_TOKEN_KEY || 'auth_token'
    this.refreshTokenKey = process.env.NEXT_PUBLIC_REFRESH_TOKEN_KEY || 'refresh_token'
    this.userKey = process.env.NEXT_PUBLIC_USER_KEY || 'user_data'
    this.tokenExpiryKey = 'token_expiry'
    this.refreshExpiryKey = 'refresh_expiry'
  }

  /**
   * Check if we're in browser environment
   */
  isBrowser() {
    return typeof window !== 'undefined'
  }

  /**
   * Safely store access token
   * NOTE: In production, use httpOnly cookies for tokens
   */
  setAccessToken(token) {
    if (!this.isBrowser()) return
    try {
      // Validate token format (basic JWT check)
      if (!this._isValidJWT(token)) {
        console.warn('[v0] Invalid token format')
        return false
      }
      localStorage.setItem(this.accessTokenKey, token)
      
      // Extract and store expiry time
      const expiryTime = this._getTokenExpiry(token)
      if (expiryTime) {
        localStorage.setItem(this.tokenExpiryKey, expiryTime.toString())
      }
      return true
    } catch (error) {
      console.error('[v0] Failed to store access token:', error)
      return false
    }
  }

  /**
   * Safely store refresh token
   */
  setRefreshToken(token) {
    if (!this.isBrowser()) return
    try {
      if (!this._isValidJWT(token)) {
        console.warn('[v0] Invalid refresh token format')
        return false
      }
      localStorage.setItem(this.refreshTokenKey, token)
      
      const expiryTime = this._getTokenExpiry(token)
      if (expiryTime) {
        localStorage.setItem(this.refreshExpiryKey, expiryTime.toString())
      }
      return true
    } catch (error) {
      console.error('[v0] Failed to store refresh token:', error)
      return false
    }
  }

  /**
   * Get access token
   */
  getAccessToken() {
    if (!this.isBrowser()) return null
    try {
      return localStorage.getItem(this.accessTokenKey)
    } catch (error) {
      console.error('[v0] Failed to retrieve access token:', error)
      return null
    }
  }

  /**
   * Get refresh token
   */
  getRefreshToken() {
    if (!this.isBrowser()) return null
    try {
      return localStorage.getItem(this.refreshTokenKey)
    } catch (error) {
      console.error('[v0] Failed to retrieve refresh token:', error)
      return null
    }
  }

  /**
   * Check if access token is valid and not expired
   */
  isAccessTokenValid() {
    if (!this.isBrowser()) return false
    const token = this.getAccessToken()
    if (!token) return false
    
    const expiryStr = localStorage.getItem(this.tokenExpiryKey)
    if (!expiryStr) return true // No expiry info, assume valid
    
    const expiry = parseInt(expiryStr, 10)
    return expiry > Date.now() / 1000
  }

  /**
   * Check if refresh token is valid and not expired
   */
  isRefreshTokenValid() {
    if (!this.isBrowser()) return false
    const token = this.getRefreshToken()
    if (!token) return false
    
    const expiryStr = localStorage.getItem(this.refreshExpiryKey)
    if (!expiryStr) return true
    
    const expiry = parseInt(expiryStr, 10)
    return expiry > Date.now() / 1000
  }

  /**
   * Store user data
   */
  setUser(user) {
    if (!this.isBrowser()) return
    try {
      localStorage.setItem(this.userKey, JSON.stringify(user))
    } catch (error) {
      console.error('[v0] Failed to store user data:', error)
    }
  }

  /**
   * Get user data
   */
  getUser() {
    if (!this.isBrowser()) return null
    try {
      const user = localStorage.getItem(this.userKey)
      return user ? JSON.parse(user) : null
    } catch (error) {
      console.error('[v0] Failed to retrieve user data:', error)
      return null
    }
  }

  /**
   * Clear all tokens and user data
   */
  clearAll() {
    if (!this.isBrowser()) return
    try {
      localStorage.removeItem(this.accessTokenKey)
      localStorage.removeItem(this.refreshTokenKey)
      localStorage.removeItem(this.userKey)
      localStorage.removeItem(this.tokenExpiryKey)
      localStorage.removeItem(this.refreshExpiryKey)
    } catch (error) {
      console.error('[v0] Failed to clear tokens:', error)
    }
  }

  /**
   * Check if user has valid authentication
   */
  hasValidAuth() {
    return this.isAccessTokenValid() || this.isRefreshTokenValid()
  }

  /**
   * Validate JWT format (basic check)
   */
  _isValidJWT(token) {
    if (typeof token !== 'string') return false
    const parts = token.split('.')
    return parts.length === 3 && parts.every(part => part.length > 0)
  }

  /**
   * Extract expiry time from JWT
   */
  _getTokenExpiry(token) {
    try {
      // JWT payload is second part
      const payload = token.split('.')[1]
      if (!payload) return null
      
      // Decode base64
      const decoded = JSON.parse(atob(payload))
      return decoded.exp // Returns Unix timestamp in seconds
    } catch (error) {
      console.warn('[v0] Failed to extract token expiry:', error)
      return null
    }
  }
}

// Create singleton instance
const tokenService = new TokenService()

export default tokenService
