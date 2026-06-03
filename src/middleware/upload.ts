import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

function makeStorage(folder: string, allowedFormats: string[]) {
  return new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `ayanfe/${folder}`,
      allowed_formats: allowedFormats,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    } as object,
  });
}

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
  else cb(new Error('Only jpeg, png, webp, gif images are allowed'));
};

const limits = { fileSize: 5 * 1024 * 1024 };

export const avatarUpload = multer({
  storage: makeStorage('avatars', ['jpg', 'jpeg', 'png', 'webp', 'gif']),
  fileFilter,
  limits,
});

export const productImageUpload = multer({
  storage: makeStorage('products', ['jpg', 'jpeg', 'png', 'webp']),
  fileFilter,
  limits,
});

export const portfolioUpload = multer({
  storage: makeStorage('portfolio', ['jpg', 'jpeg', 'png', 'webp']),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const apartmentImageUpload = multer({
  storage: makeStorage('apartments', ['jpg', 'jpeg', 'png', 'webp']),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const cleaningPhotoUpload = multer({
  storage: makeStorage('cleaning', ['jpg', 'jpeg', 'png', 'webp']),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});
