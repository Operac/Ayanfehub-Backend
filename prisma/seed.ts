import { PrismaClient, AgentStatus } from '@prisma/client'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

// ─── Real Unsplash images ────────────────────────────────────────────────────
const IMG = {
  // Markets
  mile12:    'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80',
  oyingbo:   'https://images.unsplash.com/photo-1555636222-cae831e670b3?w=800&q=80',
  balogun:   'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&q=80',
  tejuosho:  'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=800&q=80',
  alaba:     'https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=800&q=80',
  computer:  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80',
  oshodi:    'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=800&q=80',

  // Products
  tomatoes:  'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=600&q=80',
  pepper:    'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=600&q=80',
  onion:     'https://images.unsplash.com/photo-1508747703725-719777637510?w=600&q=80',
  fish:      'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?w=600&q=80',
  chicken:   'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=600&q=80',
  rice:      'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=600&q=80',
  beans:     'https://images.unsplash.com/photo-1614759068230-2c6e7f2a9f20?w=600&q=80',
  garri:     'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=600&q=80',
  plantain:  'https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=600&q=80',
  yam:       'https://images.unsplash.com/photo-1596097635121-14b63b7a0c19?w=600&q=80',
  palmOil:   'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&q=80',

  // Artisans
  artisan1:  'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=600&q=80',
  artisan2:  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
  artisan3:  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80',
  artisan4:  'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=600&q=80',
  artisan5:  'https://images.unsplash.com/photo-1596524430615-b46475ddff6e?w=600&q=80',
  artisan6:  'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&q=80',
  portfolio1:'https://images.unsplash.com/photo-1609345265499-2133bbeb6ce5?w=600&q=80',
  portfolio2:'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&q=80',
  portfolio3:'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80',
  portfolio4:'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&q=80',

  // Shortlets / Apartments
  apt1a:     'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=80',
  apt1b:     'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80',
  apt2a:     'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
  apt2b:     'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
  apt3a:     'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=800&q=80',
  apt3b:     'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
  apt4a:     'https://images.unsplash.com/photo-1536376072261-38c75010e6c9?w=800&q=80',
  apt4b:     'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&q=80',
}

async function main() {
  console.log('🌱 Starting seed...')

  // ── Delivery Zones ────────────────────────────────────────────────────────
  await prisma.deliveryZone.createMany({
    data: [
      { name: 'Lekki Phase 1 & Chevron',  deliveryFeeNgn: 3500, consolidatedDeliveryFeeNgn: 6000 },
      { name: 'Victoria Island & Ikoyi',  deliveryFeeNgn: 3500, consolidatedDeliveryFeeNgn: 6000 },
      { name: 'Yaba, Surulere & Gbagada', deliveryFeeNgn: 2500, consolidatedDeliveryFeeNgn: 5000 },
      { name: 'Ikeja, Oregun & Allen',    deliveryFeeNgn: 2500, consolidatedDeliveryFeeNgn: 5000 },
      { name: 'Ajah & Sangotedo',         deliveryFeeNgn: 4000, consolidatedDeliveryFeeNgn: 7000 },
      { name: 'Ikorodu & Mainland',       deliveryFeeNgn: 3000, consolidatedDeliveryFeeNgn: 5500 },
    ],
    skipDuplicates: true,
  })
  console.log('✅ Delivery zones created')

  // ── Markets ───────────────────────────────────────────────────────────────
  const mile12 = await prisma.market.upsert({
    where: { slug: 'mile-12' },
    update: { imageUrl: IMG.mile12 },
    create: { name: 'Mile 12', slug: 'mile-12', category: 'Perishables', imageUrl: IMG.mile12, isActive: true, phase: 1, lat: 6.6018, lng: 3.3875 },
  })

  const oyingbo = await prisma.market.upsert({
    where: { slug: 'oyingbo' },
    update: { imageUrl: IMG.oyingbo },
    create: { name: 'Oyingbo', slug: 'oyingbo', category: 'Grains & Seafood', imageUrl: IMG.oyingbo, isActive: true, phase: 1, lat: 6.4698, lng: 3.3855 },
  })

  await prisma.market.createMany({
    data: [
      { name: 'Balogun',             slug: 'balogun',          category: 'Fashion & Textiles', imageUrl: IMG.balogun,  isActive: false, phase: 2 },
      { name: 'Tejuosho',            slug: 'tejuosho',         category: 'Premium Fashion',    imageUrl: IMG.tejuosho, isActive: false, phase: 2 },
      { name: 'Alaba International', slug: 'alaba',            category: 'Electronics',        imageUrl: IMG.alaba,    isActive: false, phase: 3 },
      { name: 'Computer Village',    slug: 'computer-village', category: 'Phones & Tech',      imageUrl: IMG.computer, isActive: false, phase: 3 },
      { name: 'Oshodi',              slug: 'oshodi',           category: 'General Merchandise',imageUrl: IMG.oshodi,   isActive: false, phase: 3 },
    ],
    skipDuplicates: true,
  })
  console.log('✅ Markets created')

  // ── Run Days ──────────────────────────────────────────────────────────────
  await prisma.runDay.createMany({
    data: [
      { marketId: mile12.id,  dayOfWeek: 2, cutoffHour: 20, isMasterConsolidation: false },
      { marketId: mile12.id,  dayOfWeek: 6, cutoffHour: 20, isMasterConsolidation: true  },
      { marketId: oyingbo.id, dayOfWeek: 3, cutoffHour: 20, isMasterConsolidation: false },
      { marketId: oyingbo.id, dayOfWeek: 6, cutoffHour: 20, isMasterConsolidation: true  },
    ],
    skipDuplicates: true,
  })

  // ── Categories ────────────────────────────────────────────────────────────
  const proteins = await prisma.category.upsert({ where: { slug: 'proteins' },       update: {}, create: { name: 'Proteins',         slug: 'proteins' } })
  const grains   = await prisma.category.upsert({ where: { slug: 'grains' },         update: {}, create: { name: 'Grains',           slug: 'grains' } })
  const veg      = await prisma.category.upsert({ where: { slug: 'vegetables' },     update: {}, create: { name: 'Vegetables',       slug: 'vegetables' } })
  const tubers   = await prisma.category.upsert({ where: { slug: 'tubers' },         update: {}, create: { name: 'Tubers',           slug: 'tubers' } })
  const oils     = await prisma.category.upsert({ where: { slug: 'oils-condiments'}, update: {}, create: { name: 'Oils & Condiments',slug: 'oils-condiments' } })

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
  console.log('✅ Categories created')

  // ── System Agent ──────────────────────────────────────────────────────────
  const systemAgent = await prisma.marketAgent.upsert({
    where: { phone: '00000000000' },
    update: {},
    create: { fullName: 'System Seed', phone: '00000000000', marketId: mile12.id, employmentStatus: AgentStatus.ACTIVE },
  })

  // ── Vendors & Products ────────────────────────────────────────────────────
  // Vendor 1 — Mile 12 vegetables
  const vendor1 = await prisma.vendor.upsert({
    where: { id: 'vendor-mama-tunde' },
    update: {},
    create: {
      id: 'vendor-mama-tunde',
      marketId: mile12.id,
      businessName: 'Mama Tunde Fresh Foods',
      stallReference: 'Block A, Stall 4',
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
    },
  }).catch(() => prisma.vendor.create({
    data: { marketId: mile12.id, businessName: 'Mama Tunde Fresh Foods', stallReference: 'Block A, Stall 4', verificationStatus: 'VERIFIED', verifiedAt: new Date() }
  }))

  const productsV1 = [
    { name: 'Fresh Tomatoes',      unit: 'paint bucket', categoryId: veg.id,      price: 3500, imageUrls: [IMG.tomatoes] },
    { name: 'Scotch Bonnet Pepper',unit: 'mudu',         categoryId: veg.id,      price: 2800, imageUrls: [IMG.pepper]   },
    { name: 'Red Onions',          unit: 'big bag',      categoryId: veg.id,      price: 8500, imageUrls: [IMG.onion]    },
    { name: 'Fresh Plantain',      unit: 'bunch',        categoryId: tubers.id,   price: 2500, imageUrls: [IMG.plantain] },
    { name: 'Fresh Yam',           unit: 'tuber',        categoryId: tubers.id,   price: 1800, imageUrls: [IMG.yam]      },
    { name: 'Red Palm Oil',        unit: 'kerosene keg', categoryId: oils.id,     price: 9000, imageUrls: [IMG.palmOil]  },
  ]

  for (const p of productsV1) {
    const product = await prisma.product.create({
      data: { vendorId: vendor1.id, marketId: mile12.id, categoryId: p.categoryId, name: p.name, unit: p.unit, isActive: true, imageUrls: p.imageUrls },
    }).catch(() => null)
    if (!product) continue

    await prisma.priceEntry.create({
      data: { productId: product.id, vendorId: vendor1.id, priceNgn: p.price, recordedBy: systemAgent.id, verificationStatus: 'VERIFIED', isCurrent: true, notes: 'Seed price' },
    }).catch(() => null)
  }

  // Vendor 2 — Oyingbo fish & grains
  const vendor2 = await prisma.vendor.create({
    data: { marketId: oyingbo.id, businessName: 'Alhaji Proteins & Grains', stallReference: 'Row C, Stall 12', verificationStatus: 'VERIFIED', verifiedAt: new Date() },
  }).catch(() => null)

  if (vendor2) {
    const productsV2 = [
      { name: 'Frozen Mackerel (Titus)', unit: 'basket',    categoryId: proteins.id, price: 18000, imageUrls: [IMG.fish]    },
      { name: 'Live Catfish',            unit: 'kg',         categoryId: proteins.id, price: 3500,  imageUrls: [IMG.fish]    },
      { name: 'Whole Chicken',           unit: 'piece',      categoryId: proteins.id, price: 8500,  imageUrls: [IMG.chicken] },
      { name: 'Ofada Rice',              unit: '50kg bag',   categoryId: grains.id,   price: 65000, imageUrls: [IMG.rice]    },
      { name: 'Parboiled Rice',          unit: '50kg bag',   categoryId: grains.id,   price: 55000, imageUrls: [IMG.rice]    },
      { name: 'Black-eye Beans',         unit: 'mudu',       categoryId: grains.id,   price: 3200,  imageUrls: [IMG.beans]   },
      { name: 'Yellow Garri (Ijebu)',    unit: 'paint bucket',categoryId: grains.id,  price: 4500,  imageUrls: [IMG.garri]   },
    ]

    for (const p of productsV2) {
      const product = await prisma.product.create({
        data: { vendorId: vendor2.id, marketId: oyingbo.id, categoryId: p.categoryId, name: p.name, unit: p.unit, isActive: true, imageUrls: p.imageUrls },
      }).catch(() => null)
      if (!product) continue
      await prisma.priceEntry.create({
        data: { productId: product.id, vendorId: vendor2.id, priceNgn: p.price, recordedBy: systemAgent.id, verificationStatus: 'VERIFIED', isCurrent: true, notes: 'Seed price' },
      }).catch(() => null)
    }
  }
  console.log('✅ Vendors & products created')

  // ── Artisans ──────────────────────────────────────────────────────────────
  const artisansData = [
    {
      name: 'Chukwuemeka Okafor', category: 'Home & Property',     phone: '08011111001',
      bio: 'Expert plumber with 8+ years fixing everything from burst pipes to full bathroom installations across Lagos.',
      isAvailable: true, ratingAverage: 4.8, portfolioImages: [IMG.portfolio2, IMG.artisan1],
      services: [
        { serviceName: 'Pipe Repair',          priceNgn: 15000, turnaroundDays: 1 },
        { serviceName: 'Bathroom Installation', priceNgn: 85000, turnaroundDays: 3 },
        { serviceName: 'Gutter Cleaning',       priceNgn: 12000, turnaroundDays: 1 },
      ],
    },
    {
      name: 'Taiwo Adeyemi', category: 'Home & Property',          phone: '08011111002',
      bio: 'Licensed electrician specialising in residential wiring, inverter installations and generator maintenance.',
      isAvailable: true, ratingAverage: 4.9, portfolioImages: [IMG.portfolio1, IMG.artisan2],
      services: [
        { serviceName: 'Fault Diagnosis',       priceNgn: 10000,  turnaroundDays: 1 },
        { serviceName: 'Inverter Installation',  priceNgn: 120000, turnaroundDays: 2 },
        { serviceName: 'Generator Service',      priceNgn: 25000,  turnaroundDays: 1 },
      ],
    },
    {
      name: 'Funmilayo Bello', category: 'Personal & Fashion',      phone: '08011111003',
      bio: 'Award-winning fashion designer creating stunning Ankara and contemporary styles for all occasions.',
      isAvailable: true, ratingAverage: 4.7, portfolioImages: [IMG.portfolio3, IMG.artisan3],
      services: [
        { serviceName: 'Ankara Dress',          priceNgn: 45000, turnaroundDays: 7  },
        { serviceName: 'Agbada Full Set',        priceNgn: 80000, turnaroundDays: 10 },
        { serviceName: 'Alterations',            priceNgn: 8000,  turnaroundDays: 3  },
      ],
    },
    {
      name: 'Babatunde Salami', category: 'Home & Property',        phone: '08011111004',
      bio: 'Professional painter and wall finishing expert. Interior, exterior, POP and epoxy floor coating.',
      isAvailable: false, ratingAverage: 4.6, portfolioImages: [IMG.portfolio4, IMG.artisan4],
      services: [
        { serviceName: '1-bedroom Painting',    priceNgn: 55000,  turnaroundDays: 3 },
        { serviceName: '3-bedroom Painting',    priceNgn: 120000, turnaroundDays: 7 },
        { serviceName: 'POP Ceiling',           priceNgn: 75000,  turnaroundDays: 5 },
      ],
    },
    {
      name: 'Ngozi Eze', category: 'Food & Lifestyle',              phone: '08011111005',
      bio: 'Professional chef offering home meal prep, catering for events, and cooking classes.',
      isAvailable: true, ratingAverage: 5.0, portfolioImages: [IMG.artisan5],
      services: [
        { serviceName: 'Weekly Meal Prep (5 days)', priceNgn: 60000,  turnaroundDays: 1 },
        { serviceName: 'Event Catering (50 pax)',   priceNgn: 250000, turnaroundDays: 3 },
        { serviceName: 'Cooking Class (2hr)',        priceNgn: 20000,  turnaroundDays: 1 },
      ],
    },
    {
      name: 'Adewale Ogundimu', category: 'Home & Property',        phone: '08011111006',
      bio: 'Qualified AC technician handling installation, servicing and repair of all brands across Lagos.',
      isAvailable: true, ratingAverage: 4.5, portfolioImages: [IMG.artisan6],
      services: [
        { serviceName: 'AC Service & Gas Refill',  priceNgn: 18000, turnaroundDays: 1 },
        { serviceName: 'AC Installation',          priceNgn: 35000, turnaroundDays: 1 },
        { serviceName: 'Fault Diagnosis',          priceNgn: 8000,  turnaroundDays: 1 },
      ],
    },
  ]

  for (const a of artisansData) {
    const artisan = await prisma.artisan.create({
      data: {
        name: a.name, category: a.category, phone: a.phone, bio: a.bio,
        isAvailable: a.isAvailable, ratingAverage: a.ratingAverage,
        portfolioImages: a.portfolioImages,
        services: {
          create: a.services.map(s => ({ serviceName: s.serviceName, priceNgn: s.priceNgn, turnaroundDays: s.turnaroundDays })),
        },
      },
    }).catch(() => null)
    if (artisan) console.log(`  ↳ Artisan: ${a.name}`)
  }
  console.log('✅ Artisans created')

  // ── Shortlets ─────────────────────────────────────────────────────────────
  const shortletsData = [
    {
      name: 'The Lekki Luxe Studio',
      location: 'Lekki Phase 1, Lagos',
      description: 'A sleek, fully-furnished studio apartment in the heart of Lekki. Perfect for solo travellers and business professionals. High-speed WiFi, 24/7 power, and walking distance to Lekki Phase 1 beach.',
      ratePerNight: 35000,
      bedrooms: 1, bathrooms: 1,
      isAvailable: true,
      amenities: ['WiFi', 'Air Conditioning', '24h Power', 'Smart TV', 'Kitchen', 'Washing Machine'],
      images: [IMG.apt1a, IMG.apt1b],
    },
    {
      name: 'VI Executive 2-Bedroom',
      location: 'Victoria Island, Lagos',
      description: 'Spacious 2-bedroom apartment on the quiet side of Victoria Island. Modern furniture, fully-equipped kitchen, and stunning city views. Ideal for families and small teams.',
      ratePerNight: 65000,
      bedrooms: 2, bathrooms: 2,
      isAvailable: true,
      amenities: ['WiFi', 'Air Conditioning', '24h Power', 'Smart TV', 'Kitchen', 'Pool Access', 'Gym'],
      images: [IMG.apt2a, IMG.apt2b],
    },
    {
      name: 'Surulere Cozy 1-Bed',
      location: 'Surulere, Lagos',
      description: 'A cozy, budget-friendly 1-bedroom apartment in the vibrant Surulere neighbourhood. Close to National Stadium, shops, and restaurants. Great value for money.',
      ratePerNight: 18000,
      bedrooms: 1, bathrooms: 1,
      isAvailable: true,
      amenities: ['WiFi', 'Air Conditioning', 'Standby Generator', 'Smart TV', 'Kitchen'],
      images: [IMG.apt3a, IMG.apt3b],
    },
    {
      name: 'Ikoyi Premium Penthouse',
      location: 'Ikoyi, Lagos',
      description: 'Luxury penthouse with breathtaking views of Lagos lagoon. 3 bedrooms, private terrace, rooftop access, and concierge service. The ultimate Lagos experience.',
      ratePerNight: 150000,
      bedrooms: 3, bathrooms: 3,
      isAvailable: true,
      amenities: ['WiFi', 'Air Conditioning', '24h Power', '4K Smart TV', 'Gourmet Kitchen', 'Rooftop Terrace', 'Pool', 'Gym', 'Concierge', 'Parking'],
      images: [IMG.apt4a, IMG.apt4b],
    },
    {
      name: 'Ajah Modern Flat',
      location: 'Ajah, Lagos',
      description: 'Newly built, modern 2-bedroom flat in the fast-growing Ajah corridor. Great for long stays and families. Close to Shoprite Ajah and Abraham Adesanya Estate.',
      ratePerNight: 28000,
      bedrooms: 2, bathrooms: 2,
      isAvailable: false,  // currently occupied
      amenities: ['WiFi', 'Air Conditioning', 'Standby Generator', 'Smart TV', 'Kitchen', 'Parking'],
      images: [IMG.apt1b, IMG.apt3a],
    },
  ]

  for (const apt of shortletsData) {
    await prisma.apartment.create({
      data: {
        name: apt.name, location: apt.location,
        ratePerNight: apt.ratePerNight,
        isAvailable: apt.isAvailable, amenities: apt.amenities, images: apt.images,
      },
    }).catch(() => null)
    console.log(`  ↳ Shortlet: ${apt.name}`)
  }
  console.log('✅ Shortlets created')

  // ── Promo Codes ───────────────────────────────────────────────────────────
  const oneYearLater = new Date(new Date().getFullYear() + 1, new Date().getMonth(), new Date().getDate())
  const promos = [
    { code: 'WELCOME20', discountType: 'PERCENTAGE', discountValue: 20, description: '20% off your first order', maxUsesTotal: 500 },
    { code: 'SAVE1000',  discountType: 'FIXED',      discountValue: 1000, description: '₦1,000 off any order', minOrderNgn: 5000, maxUsesTotal: 200 },
    { code: 'LAGOS50',   discountType: 'PERCENTAGE', discountValue: 50, description: '50% off (launch special)', maxUsesTotal: 100, minOrderNgn: 10000 },
  ]

  for (const p of promos) {
    await prisma.promotion.create({
      data: {
        code: p.code, discountType: p.discountType as any, discountValue: p.discountValue,
        description: p.description, minOrderNgn: (p as any).minOrderNgn,
        maxUsesTotal: p.maxUsesTotal, isActive: true,
        validFrom: new Date(), validTo: oneYearLater,
      },
    }).catch(() => null)
  }
  console.log('✅ Promo codes created')

  console.log('\n🎉 Seed complete!')
  console.log('   Markets: 7 (2 active) · Vendors: 2 · Products: 13')
  console.log('   Artisans: 6 · Shortlets: 5 · Promos: 3')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
