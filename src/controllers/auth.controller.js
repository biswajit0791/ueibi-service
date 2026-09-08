import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.tenantUser.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        tenant: true,
        bankDetails: true,
        workHistory: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Access forbidden: this account is inactive/exited' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    });

    // Set HTTP-only session cookie
    res.cookie('ueibi_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        designation: user.designation,
        department: user.department,
        band: user.band,
        phone: user.phone,
        pan: user.pan,
        aadhaar: user.aadhaar,
        dob: user.dob,
        joinDate: user.joinDate,
        gender: user.gender,
        bloodGroup: user.bloodGroup,
        personalEmail: user.personalEmail,
        emergencyContact: user.emergencyContact,
        uan: user.uan,
        esic: user.esic,
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : [],
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.tenantUser.findUnique({
      where: { id: req.user.id },
      include: { 
        tenant: true,
        bankDetails: true,
        workHistory: true
      },
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Access forbidden: this account is inactive/exited' });
    }


    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        designation: user.designation,
        department: user.department,
        band: user.band,
        phone: user.phone,
        pan: user.pan,
        aadhaar: user.aadhaar,
        dob: user.dob,
        joinDate: user.joinDate,
        gender: user.gender,
        bloodGroup: user.bloodGroup,
        personalEmail: user.personalEmail,
        emergencyContact: user.emergencyContact,
        uan: user.uan,
        esic: user.esic,
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : [],
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
      },
    });
  } catch (err) {
    next(err);
  }
}

export function logout(req, res) {
  res.clearCookie('ueibi_session', { path: '/' });
  res.json({ ok: true });
}
