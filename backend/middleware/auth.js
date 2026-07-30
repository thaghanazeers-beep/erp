const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * requireAuth — verifies the app-issued JWT (obtained via Microsoft SSO)
 * and loads the current user onto req.user. Reloading from DB each request
 * means role changes / deactivation take effect immediately.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || user.active === false) {
      return res.status(401).json({ message: 'Invalid session' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/** requireAdmin — must run after requireAuth. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

/** issueToken — signs the app session JWT for a user. */
function issueToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, requireAdmin, issueToken };
