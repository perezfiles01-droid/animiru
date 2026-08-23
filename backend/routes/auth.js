const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';

// Mock user database (replace with actual Firebase Firestore)
const users = new Map();

/**
 * Register user
 * POST /api/auth/register
 */
router.post('/register', (req, res, next) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password, and username required' });
    }

    if (users.has(email)) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const userId = crypto.randomUUID();

    users.set(email, {
      id: userId,
      email,
      username,
      passwordHash,
      createdAt: new Date()
    });

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      user: { id: userId, email, username },
      token
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Login user
 * POST /api/auth/login
 */
router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (passwordHash !== user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      user: { id: user.id, email: user.email, username: user.username },
      token
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Verify token
 * GET /api/auth/me
 */
router.get('/me', (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = users.get(decoded.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: { id: user.id, email: user.email, username: user.username }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(error);
  }
});

module.exports = router;
