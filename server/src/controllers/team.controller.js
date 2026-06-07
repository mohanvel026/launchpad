const User    = require('../models/User.model');
const Project = require('../models/Project.model');
const { sendCollaboratorInvite } = require('../services/notification.service');

// POST /api/team/:projectId/invite
// Invite a GitHub user to collaborate on a project
const inviteCollaborator = async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ message: 'GitHub username is required' });

  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Find the user by GitHub username
    const invitee = await User.findOne({ username });
    if (!invitee) {
      return res.status(404).json({ message: `User "${username}" not found. They must log in to LaunchLive first.` });
    }

    // Check if already a collaborator
    if (project.collaborators.includes(invitee._id)) {
      return res.status(400).json({ message: 'User is already a collaborator' });
    }

    // Check not inviting yourself
    if (invitee._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot invite yourself' });
    }

    // Add collaborator
    await Project.findByIdAndUpdate(project._id, {
      $push: { collaborators: invitee._id },
    });

    // Send email notification
    if (invitee.email) {
      await sendCollaboratorInvite(invitee.email, {
        inviterName:  req.user.username,
        projectName:  project.name,
        projectUrl:   `${process.env.CLIENT_URL}/projects/${project._id}`,
      });
    }

    res.json({ message: `${username} added as collaborator`, collaborator: { _id: invitee._id, username: invitee.username, avatarUrl: invitee.avatarUrl } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/team/:projectId/remove/:userId
const removeCollaborator = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await Project.findByIdAndUpdate(project._id, {
      $pull: { collaborators: req.params.userId },
    });

    res.json({ message: 'Collaborator removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/team/:projectId
const getCollaborators = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).populate('collaborators', 'username avatarUrl email')
      .populate('owner', 'username avatarUrl');

    if (!project) return res.status(404).json({ message: 'Project not found' });

    res.json({
      owner:         project.owner,
      collaborators: project.collaborators,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { inviteCollaborator, removeCollaborator, getCollaborators };