import { config } from 'dotenv';
import prisma from '../config/db';
import { hashPassword } from '../utils/auth';
import { z } from 'zod';

config();

const createAdmin = async () => {
  const email    = process.argv[2]; // pass '-' to skip
  const phone    = process.argv[3];
  const password = process.argv[4];

  if (!phone || !password) {
    console.error('Usage: npm run create-admin <email|-> <phone> <password>');
    process.exit(1);
  }

  try {
    z.string().min(7).parse(phone);
    z.string().min(6).parse(password);
    if (email && email !== '-') z.string().email().parse(email);

    const emailValue = email && email !== '-' ? email : undefined;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ phone }, ...(emailValue ? [{ email: emailValue }] : [])] }
    });

    if (existing) {
      console.log('User already exists. Updating role to ADMIN...');
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
      console.log('Successfully updated to ADMIN.');
    } else {
      const hashedPassword = await hashPassword(password);
      await prisma.user.create({
        data: { phone, email: emailValue, passwordHash: hashedPassword, role: 'ADMIN' }
      });
      console.log(`Successfully created admin user: ${emailValue || phone}`);
    }
  } catch (error) {
    console.error('Error creating admin:', error);
  } finally {
    await prisma.$disconnect();
  }
};

createAdmin();
