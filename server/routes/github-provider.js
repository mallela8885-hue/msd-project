const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const githubProviderController = require('../controllers/githubProviderController');

// Get user's GitHub repositories
router.get('/repositories', authMiddleware, githubProviderController.getRepositories);

// Get repository details
router.get('/repositories/:owner/:repo', authMiddleware, githubProviderController.getRepositoryDetails);

// Get repository branches
router.get('/repositories/:owner/:repo/branches', authMiddleware, githubProviderController.getRepositoryBranches);

// Get repository file content
router.get('/repositories/:owner/:repo/file/:path', authMiddleware, githubProviderController.getRepositoryFile);

// Connect GitHub account
router.post('/connect', authMiddleware, githubProviderController.connectGitHub);

// Disconnect GitHub account
router.post('/disconnect', authMiddleware, githubProviderController.disconnectGitHub);

// Check GitHub connection status
router.get('/status', authMiddleware, githubProviderController.getConnectionStatus);

// Get repository webhooks
router.get('/repositories/:owner/:repo/webhooks', authMiddleware, githubProviderController.getWebhooks);

// Create deployment webhook
router.post('/repositories/:owner/:repo/webhooks/deployment', authMiddleware, githubProviderController.createDeploymentWebhook);

// Import repository and create project
router.post('/import', authMiddleware, githubProviderController.importRepository);

// Handle GitHub webhook for auto-deploy
router.post('/webhook/:projectId', githubProviderController.handleGitHubWebhook);

module.exports = router;
