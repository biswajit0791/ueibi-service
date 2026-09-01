import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const JWT_EXPIRY = '24h';
const JWT_ALGORITHM = 'HS256';

export function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: JWT_EXPIRY,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret, {
      algorithms: [JWT_ALGORITHM],
    });
  } catch (err) {
    return null;
  }
}

