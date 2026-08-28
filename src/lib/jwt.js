import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const JWT_EXPIRY = '24h';

export function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (err) {
    return null;
  }
}
