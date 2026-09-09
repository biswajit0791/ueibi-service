export function authorize(...allowedRoles) {
  const flattened = allowedRoles.flat(Infinity).map(r => String(r || '').toUpperCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    if (!flattened.includes(userRole)) {
      return res.status(403).json({ error: 'Access forbidden: insufficient permissions' });
    }
    next();
  };
}

export const requireRole = authorize;

