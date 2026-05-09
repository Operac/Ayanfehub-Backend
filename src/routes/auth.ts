import { Router } from 'express';
import {
  register, login, logout, getSession,
  getProfile, updateProfile, uploadAvatar,
  createAddress, getAddresses, updateAddress, deleteAddress
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { avatarUpload } from '../middleware/upload';

const router = Router();

// Authentication
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/session', authenticate, getSession);

// Profile
router.get('/profile', authenticate, getProfile);
router.patch('/profile', authenticate, updateProfile);
router.post('/avatar', authenticate, avatarUpload.single('avatar'), uploadAvatar);

// Addresses
router.get('/addresses', authenticate, getAddresses);
router.post('/addresses', authenticate, createAddress);
router.patch('/addresses/:addressId', authenticate, updateAddress);
router.delete('/addresses/:addressId', authenticate, deleteAddress);

export default router;
