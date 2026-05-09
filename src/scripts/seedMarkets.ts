// Full seed is in prisma/seed.ts — run via: npx prisma db seed
import { execSync } from 'child_process'

execSync('npx ts-node prisma/seed.ts', { stdio: 'inherit' })
