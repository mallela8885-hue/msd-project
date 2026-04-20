/**
 * Authentication System Upgrade Migration
 * Adds provider linking support and strengthens duplicate email prevention
 */

const mongoose = require('mongoose');

class AuthUpgradeMigration {
  /**
   * RUN MIGRATION - Add unique constraints for provider fields
   */
  static async up() {
    console.log('Starting auth upgrade migration...');

    try {
      const db = mongoose.connection.db;
      
      // Drop old indexes if they exist (to avoid conflicts)
      try {
        await db.collection('users').dropIndex('oauth.google.id_1');
      } catch (e) {
        // Index may not exist, that's fine
      }

      try {
        await db.collection('users').dropIndex('oauth.github.id_1');
      } catch (e) {
        // Index may not exist, that's fine
      }

      // Add new indexes with sparse constraint (allows multiple null values)
      // This ensures unique provider IDs while allowing users without them
      await db.collection('users').createIndex(
        { 'oauth.google.id': 1 },
        { unique: true, sparse: true }
      );

      await db.collection('users').createIndex(
        { 'oauth.github.id': 1 },
        { unique: true, sparse: true }
      );

      // Ensure email index is unique (it already is, but be explicit)
      await db.collection('users').createIndex(
        { email: 1 },
        { unique: true }
      );

      console.log('✓ Auth upgrade migration completed successfully');
      console.log('✓ Added unique sparse indexes for OAuth provider IDs');
      console.log('✓ Email uniqueness constraint verified');

    } catch (error) {
      console.error('✗ Migration failed:', error.message);
      throw error;
    }
  }

  /**
   * ROLLBACK - Remove new indexes
   */
  static async down() {
    console.log('Rolling back auth upgrade migration...');

    try {
      const db = mongoose.connection.db;

      // Drop the new indexes we created
      await db.collection('users').dropIndex('oauth.google.id_1');
      await db.collection('users').dropIndex('oauth.github.id_1');

      console.log('✓ Migration rollback completed');

    } catch (error) {
      console.error('✗ Rollback failed:', error.message);
      throw error;
    }
  }
}

module.exports = AuthUpgradeMigration;
