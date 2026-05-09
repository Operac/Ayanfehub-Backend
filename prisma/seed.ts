import { PrismaClient, AgentStatus } from '@prisma/client'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

async function main() {
  // Delivery zones
  await Promise.all([
    prisma.deliveryZone.upsert({ where: { name: 'Lekki Phase 1 & Chevron' },    update: {}, create: { name: 'Lekki Phase 1 & Chevron',    deliveryFeeNgn: 3500, consolidatedDeliveryFeeNgn: 6000 } }),
    prisma.deliveryZone.upsert({ where: { name: 'Victoria Island & Ikoyi' },    update: {}, create: { name: 'Victoria Island & Ikoyi',    deliveryFeeNgn: 3500, consolidatedDeliveryFeeNgn: 6000 } }),
    prisma.deliveryZone.upsert({ where: { name: 'Yaba, Surulere & Gbagada' },   update: {}, create: { name: 'Yaba, Surulere & Gbagada',   deliveryFeeNgn: 2500, consolidatedDeliveryFeeNgn: 5000 } }),
    prisma.deliveryZone.upsert({ where: { name: 'Ikeja, Oregun & Allen' },      update: {}, create: { name: 'Ikeja, Oregun & Allen',      deliveryFeeNgn: 2500, consolidatedDeliveryFeeNgn: 5000 } }),
    prisma.deliveryZone.upsert({ where: { name: 'Ajah & Sangotedo' },           update: {}, create: { name: 'Ajah & Sangotedo',           deliveryFeeNgn: 4000, consolidatedDeliveryFeeNgn: 7000 } }),
  ])

  // Market nodes
  const mile12 = await prisma.market.upsert({
    where: { slug: 'mile-12' },
    update: {},
    create: {
      name: 'Mile 12',
      slug: 'mile-12',
      category: 'Perishables',
      isActive: true,
      phase: 1,
      lat: 6.6018,
      lng: 3.3875,
    },
  })

  const oyingbo = await prisma.market.upsert({
    where: { slug: 'oyingbo' },
    update: {},
    create: {
      name: 'Oyingbo',
      slug: 'oyingbo',
      category: 'Grains & Seafood',
      isActive: true,
      phase: 1,
      lat: 6.4698,
      lng: 3.3855,
    },
  })

  // Inactive phase 2+ nodes (scaffold only)
  await prisma.market.createMany({
    data: [
      { name: 'Balogun',             slug: 'balogun',          category: 'Fashion & Textiles', isActive: false, phase: 2 },
      { name: 'Tejuosho',            slug: 'tejuosho',         category: 'Premium Fashion',    isActive: false, phase: 2 },
      { name: 'Alaba International', slug: 'alaba',            category: 'Electronics',        isActive: false, phase: 3 },
      { name: 'Computer Village',    slug: 'computer-village', category: 'Phones & Tech',      isActive: false, phase: 3 },
      { name: 'Oshodi',              slug: 'oshodi',           category: 'General Merchandise',isActive: false, phase: 3 },
    ],
    skipDuplicates: true,
  })

  // Run days — Mile 12: Tuesday + Saturday
  await prisma.runDay.createMany({
    data: [
      { marketId: mile12.id, dayOfWeek: 2, cutoffHour: 20, isMasterConsolidation: false },
      { marketId: mile12.id, dayOfWeek: 6, cutoffHour: 20, isMasterConsolidation: true  },
    ],
    skipDuplicates: true,
  })

  // Run days — Oyingbo: Wednesday + Saturday
  await prisma.runDay.createMany({
    data: [
      { marketId: oyingbo.id, dayOfWeek: 3, cutoffHour: 20, isMasterConsolidation: false },
      { marketId: oyingbo.id, dayOfWeek: 6, cutoffHour: 20, isMasterConsolidation: true  },
    ],
    skipDuplicates: true,
  })

  // Categories
  const proteins = await prisma.category.upsert({ where: { slug: 'proteins' },         update: {}, create: { name: 'Proteins',          slug: 'proteins' } })
  const grains   = await prisma.category.upsert({ where: { slug: 'grains' },           update: {}, create: { name: 'Grains',            slug: 'grains' } })
  const veg      = await prisma.category.upsert({ where: { slug: 'vegetables' },       update: {}, create: { name: 'Vegetables',        slug: 'vegetables' } })
  await prisma.category.upsert({ where: { slug: 'oils-condiments' }, update: {}, create: { name: 'Oils & Condiments', slug: 'oils-condiments' } })
  await prisma.category.upsert({ where: { slug: 'tubers' },          update: {}, create: { name: 'Tubers',            slug: 'tubers' } })

  // Subcategories
  await prisma.category.createMany({
    data: [
      { name: 'Fish',      slug: 'fish',      parentId: proteins.id },
      { name: 'Chicken',   slug: 'chicken',   parentId: proteins.id },
      { name: 'Stockfish', slug: 'stockfish', parentId: proteins.id },
      { name: 'Rice',      slug: 'rice',      parentId: grains.id   },
      { name: 'Beans',     slug: 'beans',     parentId: grains.id   },
      { name: 'Garri',     slug: 'garri',     parentId: grains.id   },
    ],
    skipDuplicates: true,
  })

  // System agent for seeded prices
  const systemAgent = await prisma.marketAgent.upsert({
    where: { phone: '00000000000' },
    update: {},
    create: {
      fullName: 'System Seed',
      phone: '00000000000',
      marketId: mile12.id,
      employmentStatus: AgentStatus.ACTIVE,
    },
  })

  // Seed vendor + products for Mile 12
  const vendor1 = await prisma.vendor.create({
    data: {
      marketId: mile12.id,
      businessName: 'Mama Tunde Fresh Foods',
      stallReference: 'Block A, Stall 4',
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
    },
  })

  const tomatoes = await prisma.product.create({
    data: {
      vendorId: vendor1.id,
      marketId: mile12.id,
      categoryId: veg.id,
      name: 'Fresh Tomatoes',
      unit: 'paint bucket',
      minOrderQuantity: 1,
      isActive: true,
    },
  })

  // Seed initial verified price
  await prisma.priceEntry.create({
    data: {
      productId: tomatoes.id,
      vendorId: vendor1.id,
      priceNgn: 3500,
      recordedBy: systemAgent.id,
      verificationStatus: 'VERIFIED',
      isCurrent: true,
      notes: 'Seed price',
    },
  })

  console.log('Seed complete')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
