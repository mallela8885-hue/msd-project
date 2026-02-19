const axios = require('axios');
const GitHubIntegration = require('../models/GitHubIntegration');

const GITHUB_API_BASE = 'https://api.github.com';

class GitHubProviderController {
  // Get user's GitHub repositories
  static async getRepositories(req, res) {
    try {
      const userId = req.user._id;
      console.log('=== FETCH REPOSITORIES ===');
      console.log('User ID:', userId);
      
      const integration = await GitHubIntegration.findOne({ userId });
      console.log('GitHub integration found:', !!integration);
      
      if (!integration) {
        console.error('No GitHub integration found for user:', userId);
        console.log('Available integrations in DB:', await GitHubIntegration.countDocuments());
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      console.log('GitHub username:', integration.githubUsername);
      console.log('Access token length:', integration.accessToken?.length);
      console.log('Token starts with:', integration.accessToken?.substring(0, 10));
      
      // Fetch repositories with affiliation parameter to get:
      // - owner: repositories owned by the user
      // - collaborator: repositories the user is a collaborator on
      // - organization_member: repositories of organizations the user is a member of
      const allRepos = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await axios.get(`${GITHUB_API_BASE}/user/repos`, {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
          params: {
            affiliation: 'owner,collaborator,organization_member',
            sort: 'updated',
            per_page: 100,
            page: page,
          },
        });

        console.log(`GitHub API response - page ${page}, repos count:`, response.data.length);
        
        if (response.data.length === 0) {
          hasMore = false;
        } else {
          allRepos.push(...response.data);
          page++;
          
          // GitHub API returns max 100 items per page, if less than 100, no more pages
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      }

      console.log('Total repositories fetched:', allRepos.length);
      console.log('First repo:', allRepos[0]?.name);
      
      const repos = allRepos.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        owner: repo.owner.login,
        isPrivate: repo.private,
        language: repo.language,
        topics: repo.topics || [],
        stars: repo.stargazers_count,
        defaultBranch: repo.default_branch,
      }));

      console.log('Returning', repos.length, 'repositories');
      res.json(repos);
    } catch (error) {
      console.error('=== FETCH REPOSITORIES ERROR ===');
      console.error('Status:', error.response?.status);
      console.error('GitHub Error:', error.response?.data);
      console.error('Message:', error.message);
      
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to fetch repositories',
        details: error.response?.data,
      });
    }
  }

  // Get repository details
  static async getRepositoryDetails(req, res) {
    try {
      const userId = req.user._id;
      const { owner, repo } = req.params;
      const integration = await GitHubIntegration.findOne({ userId });

      if (!integration) {
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      const response = await axios.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const data = response.data;
      res.json({
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        url: data.html_url,
        owner: data.owner.login,
        isPrivate: data.private,
        language: data.language,
        topics: data.topics || [],
        stars: data.stargazers_count,
        forks: data.forks_count,
        defaultBranch: data.default_branch,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        pushedAt: data.pushed_at,
        size: data.size,
        hasIssues: data.has_issues,
        hasPages: data.has_pages,
        homepage: data.homepage,
      });
    } catch (error) {
      console.error('Failed to fetch repository details:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to fetch repository details',
      });
    }
  }

  // Get repository branches
  static async getRepositoryBranches(req, res) {
    try {
      const userId = req.user._id;
      const { owner, repo } = req.params;
      const integration = await GitHubIntegration.findOne({ userId });

      if (!integration) {
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      const response = await axios.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}/branches`, {
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
        params: {
          per_page: 100,
        },
      });

      const branches = response.data.map(branch => ({
        name: branch.name,
        commit: branch.commit.sha.substring(0, 7),
        commitUrl: branch.commit.url,
        protected: branch.protected,
      }));

      res.json(branches);
    } catch (error) {
      console.error('Failed to fetch branches:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to fetch branches',
      });
    }
  }

  // Get repository file content
  static async getRepositoryFile(req, res) {
    try {
      const userId = req.user._id;
      const { owner, repo, path } = req.params;
      const { ref } = req.query;
      const integration = await GitHubIntegration.findOne({ userId });

      if (!integration) {
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      const params = { per_page: 100 };
      if (ref) params.ref = ref;

      const response = await axios.get(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`,
        {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            Accept: 'application/vnd.github.v3.raw+json',
          },
          params,
        }
      );

      // If it's a directory, return list of files
      if (Array.isArray(response.data)) {
        const files = response.data.map(file => ({
          name: file.name,
          type: file.type,
          path: file.path,
          url: file.html_url,
        }));
        return res.json(files);
      }

      // If it's a file, return content
      res.json({
        content: response.data,
        encoding: 'utf-8',
      });
    } catch (error) {
      console.error('Failed to fetch file:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to fetch file',
      });
    }
  }

  // Connect GitHub account
  static async connectGitHub(req, res) {
    try {
      const userId = req.user._id;
      const { accessToken, refreshToken, expiresAt } = req.body;

      if (!accessToken) {
        return res.status(400).json({ error: 'Access token required' });
      }

      // Verify token by making a test request
      const userResponse = await axios.get(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const integration = await GitHubIntegration.findOneAndUpdate(
        { userId },
        {
          userId,
          githubUsername: userResponse.data.login,
          accessToken,
          refreshToken,
          expiresAt,
          connectedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      res.json({
        message: 'GitHub connected successfully',
        username: userResponse.data.login,
        avatar: userResponse.data.avatar_url,
      });
    } catch (error) {
      console.error('Failed to connect GitHub:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to connect GitHub account',
      });
    }
  }

  // Disconnect GitHub account
  static async disconnectGitHub(req, res) {
    try {
      const userId = req.user._id;
      await GitHubIntegration.deleteOne({ userId });
      res.json({ message: 'GitHub disconnected successfully' });
    } catch (error) {
      console.error('Failed to disconnect GitHub:', error.message);
      res.status(500).json({ error: 'Failed to disconnect GitHub account' });
    }
  }

  // Get connection status
  static async getConnectionStatus(req, res) {
    try {
      const userId = req.user._id;
      console.log('Checking GitHub connection status for user:', userId);
      
      const integration = await GitHubIntegration.findOne({ userId });
      console.log('GitHub integration record found:', !!integration);

      if (!integration) {
        console.log('No integration found, returning connected: false');
        return res.json({ connected: false });
      }

      console.log('Integration exists - username:', integration.githubUsername);
      console.log('Access token present:', !!integration.accessToken);

      // Verify token is still valid
      try {
        const userResponse = await axios.get(`${GITHUB_API_BASE}/user`, {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });

        console.log('Token validation successful - user:', userResponse.data.login);
        
        res.json({
          connected: true,
          username: userResponse.data.login,
          avatar: userResponse.data.avatar_url,
          connectedAt: integration.connectedAt,
        });
      } catch (error) {
        console.error('Token validation failed:', error.response?.status, error.response?.data?.message);
        // Token is invalid, disconnect
        await GitHubIntegration.deleteOne({ userId });
        res.json({ connected: false });
      }
    } catch (error) {
      console.error('Failed to get connection status:', error.message);
      res.status(500).json({ error: 'Failed to get connection status' });
    }
  }

  // Get repository webhooks
  static async getWebhooks(req, res) {
    try {
      const userId = req.user._id;
      const { owner, repo } = req.params;
      const integration = await GitHubIntegration.findOne({ userId });

      if (!integration) {
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      const response = await axios.get(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks`,
        {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      const webhooks = response.data
        .filter(hook => hook.config.url && hook.config.url.includes('deployer'))
        .map(hook => ({
          id: hook.id,
          url: hook.config.url,
          events: hook.events,
          active: hook.active,
          createdAt: hook.created_at,
        }));

      res.json(webhooks);
    } catch (error) {
      console.error('Failed to fetch webhooks:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to fetch webhooks',
      });
    }
  }

  // Create deployment webhook
  static async createDeploymentWebhook(req, res) {
    try {
      const userId = req.user._id;
      const { owner, repo } = req.params;
      const integration = await GitHubIntegration.findOne({ userId });

      if (!integration) {
        return res.status(404).json({ error: 'GitHub integration not connected' });
      }

      const webhookUrl = `${process.env.WEBHOOK_URL || 'http://localhost:5000'}/webhooks/github/${repo}`;

      const response = await axios.post(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks`,
        {
          name: 'web',
          active: true,
          events: ['push', 'pull_request'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: process.env.GITHUB_WEBHOOK_SECRET,
            insecure_ssl: '0',
          },
        },
        {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      res.json({
        message: 'Webhook created successfully',
        id: response.data.id,
        url: webhookUrl,
      });
    } catch (error) {
      console.error('Failed to create webhook:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to create webhook',
      });
    }
  }

  // Import repository and create project with auto-deploy
  static async importRepository(req, res) {
    try {
      const userId = req.user._id;
      const { repoFullName, branch, framework, buildCommand, outputDirectory, environmentVariables } = req.body;
      const Project = require('../models/Project');
      const deploymentService = require('../services/deploymentService');
      const crypto = require('crypto');

      const integration = await GitHubIntegration.findOne({ userId });
      if (!integration) {
        return res.status(404).json({ error: 'GitHub not connected' });
      }

      const [owner, repo] = repoFullName.split('/');

      // Get repository details
      const repoResponse = await axios.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const repoData = repoResponse.data;

      // Create project
      const project = new Project({
        name: repo,
        userId,
        framework: framework || 'nextjs',
        repository: {
          provider: 'github',
          url: repoData.clone_url,
          owner,
          name: repo,
          branch: branch || repoData.default_branch,
          fullName: repoFullName,
          isPrivate: repoData.private,
        },
        buildSettings: {
          buildCommand: buildCommand || 'npm run build',
          outputDirectory: outputDirectory || 'out',
          installCommand: 'npm install',
        },
        environmentVariables: environmentVariables || [],
        autoDeployEnabled: true,
        status: 'active',
      });

      await project.save();

      // Setup webhook for auto-deploy
      const webhookUrl = `${process.env.API_URL}/api/webhooks/github/${project._id}`;
      const webhookSecret = crypto.randomBytes(32).toString('hex');

      try {
        const webhookResponse = await axios.post(
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks`,
          {
            name: 'web',
            active: true,
            events: ['push', 'pull_request'],
            config: {
              url: webhookUrl,
              content_type: 'json',
              secret: webhookSecret,
              insecure_ssl: '0',
            },
          },
          {
            headers: {
              Authorization: `Bearer ${integration.accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        project.repository.webhookId = webhookResponse.data.id;
        project.repository.webhookSecret = webhookSecret;
        await project.save();
      } catch (webhookError) {
        console.error('Failed to create webhook:', webhookError.response?.data);
      }

      // Trigger initial deployment
      const deployment = await deploymentService.createDeployment({
        projectId: project._id,
        gitCommit: repoData.default_branch,
        gitBranch: branch || repoData.default_branch,
        gitAuthor: req.user.name,
        commitMessage: 'Initial deployment',
        environment: 'production',
      });

      res.status(201).json({
        project,
        deployment,
        message: 'Repository imported successfully',
      });
    } catch (error) {
      console.error('Import repository error:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'Failed to import repository',
      });
    }
  }

  // Handle GitHub webhook for auto-deploy
  static async handleGitHubWebhook(req, res) {
    try {
      const { projectId } = req.params;
      const signature = req.headers['x-hub-signature-256'];
      const payload = req.body;
      const Project = require('../models/Project');
      const deploymentService = require('../services/deploymentService');
      const crypto = require('crypto');

      const project = await Project.findById(projectId);
      if (!project || !project.repository) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Verify webhook signature
      if (project.repository.webhookSecret) {
        const hmac = crypto.createHmac('sha256', project.repository.webhookSecret);
        const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
        
        if (signature !== digest) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      // Handle push event
      if (payload.ref && payload.ref.includes(project.repository.branch)) {
        const deployment = await deploymentService.createDeployment({
          projectId: project._id,
          gitCommit: payload.after,
          gitBranch: payload.ref.replace('refs/heads/', ''),
          gitAuthor: payload.pusher?.name || 'unknown',
          commitMessage: payload.head_commit?.message || 'No message',
          environment: 'production',
        });

        return res.status(202).json({ deployment, message: 'Deployment triggered' });
      }

      // Handle pull request event
      if (payload.pull_request && (payload.action === 'opened' || payload.action === 'synchronize')) {
        const deployment = await deploymentService.createDeployment({
          projectId: project._id,
          gitCommit: payload.pull_request.head.sha,
          gitBranch: payload.pull_request.head.ref,
          gitAuthor: payload.pull_request.user.login,
          commitMessage: payload.pull_request.title,
          environment: 'preview',
        });

        return res.status(202).json({ deployment, message: 'Preview deployment triggered' });
      }

      res.json({ message: 'Webhook received' });
    } catch (error) {
      console.error('Webhook error:', error.message);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
}

module.exports = GitHubProviderController;
