/**
 * Development/demo seed. Refuses to run in production. All credentials are demo-only and printed at the end.
 * Usage: npm run seed -w @tablya/api   (SEED_PASSWORD overrides the shared demo password)
 */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizeSearch } from '@tablya/shared';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? 'DemoPassw0rd!';

async function user(email: string, name: string, roles: Role[], locale = 'en') {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      roles,
      locale,
      passwordHash: await argon2.hash(PASSWORD),
      emailVerifiedAt: new Date(),
      customerProfile: { create: {} },
      notificationPref: { create: {} },
      ...(roles.includes('COOK') ? { cookProfile: { create: {} } } : {}),
    },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed a production database');

  const admin = await user('admin@tablya.test', 'Demo Super Admin', ['SUPER_ADMIN']);
  await user('support@tablya.test', 'Demo Support', ['SUPPORT']);
  await user('moderator@tablya.test', 'Demo Moderator', ['MODERATOR']);
  const customer = await user('customer@tablya.test', 'Demo Customer', ['CUSTOMER']);
  const customerAr = await user('customer.ar@tablya.test', 'عميل تجريبي', ['CUSTOMER'], 'ar');
  await prisma.address.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      userId: customer.id,
      label: 'Home',
      line1: '12 Olaya Street',
      city: 'Riyadh',
      lat: 24.72,
      lng: 46.68,
      isDefault: true,
    },
  });

  const cuisineData = [
    ['saudi', 'Saudi', 'سعودي'],
    ['levantine', 'Levantine', 'شامي'],
    ['italian', 'Italian', 'إيطالي'],
    ['desserts', 'Desserts', 'حلويات'],
    ['healthy', 'Healthy', 'صحي'],
  ];
  const cuisines: Record<string, string> = {};
  for (const [i, [slug, name, nameAr]] of cuisineData.entries())
    cuisines[slug] = (
      await prisma.cuisine.upsert({
        where: { slug },
        update: {},
        create: { slug, name, nameAr, sortOrder: i },
      })
    ).id;
  const categoryData = [
    ['mains', 'Main dishes', 'أطباق رئيسية'],
    ['appetizers', 'Appetizers', 'مقبلات'],
    ['desserts', 'Desserts', 'حلويات'],
    ['drinks', 'Drinks', 'مشروبات'],
    ['bakery', 'Bakery', 'مخبوزات'],
  ];
  const categories: Record<string, string> = {};
  for (const [i, [slug, name, nameAr]] of categoryData.entries())
    categories[slug] = (
      await prisma.category.upsert({
        where: { slug },
        update: {},
        create: { slug, name, nameAr, sortOrder: i },
      })
    ).id;

  const kitchens = [
    {
      email: 'cook.fatima@tablya.test',
      cook: 'Fatima Al-Harbi',
      slug: 'fatima-home-kitchen',
      name: 'Fatima Home Kitchen',
      nameAr: 'مطبخ فاطمة',
      cuisine: 'saudi',
      lat: 24.7136,
      lng: 46.6753,
      items: [
        [
          'Chicken Kabsa',
          'كبسة دجاج',
          'mains',
          3800,
          'Fragrant rice with spiced chicken',
          ['rice', 'chicken', 'spices'],
          [],
        ],
        [
          'Jareesh',
          'جريش',
          'mains',
          3200,
          'Slow-cooked cracked wheat',
          ['wheat', 'yogurt'],
          ['milk'],
        ],
        [
          'Luqaimat',
          'لقيمات',
          'desserts',
          1800,
          'Crispy dumplings with date syrup',
          ['flour', 'dates'],
          ['gluten'],
        ],
      ],
    },
    {
      email: 'cook.layla@tablya.test',
      cook: 'Layla Haddad',
      slug: 'layla-levant-table',
      name: "Layla's Levant Table",
      nameAr: 'مائدة ليلى الشامية',
      cuisine: 'levantine',
      lat: 24.73,
      lng: 46.69,
      items: [
        [
          'Mixed Mezze Platter',
          'مقبلات مشكلة',
          'appetizers',
          4500,
          'Hummus, moutabal, tabbouleh, fattoush',
          ['chickpeas', 'eggplant', 'parsley'],
          ['sesame'],
        ],
        [
          'Chicken Shawarma Plate',
          'صحن شاورما دجاج',
          'mains',
          3400,
          'With garlic sauce and pickles',
          ['chicken', 'garlic'],
          [],
        ],
        [
          'Knafeh',
          'كنافة',
          'desserts',
          2800,
          'Warm cheese pastry with syrup',
          ['cheese', 'semolina'],
          ['milk', 'gluten'],
        ],
      ],
    },
    {
      email: 'cook.marco@tablya.test',
      cook: 'Marco Rossi',
      slug: 'marco-pasta-house',
      name: "Marco's Pasta House",
      nameAr: 'بيت مارکو للباستا',
      cuisine: 'italian',
      lat: 24.69,
      lng: 46.71,
      items: [
        [
          'Lasagna al Forno',
          'لازانيا',
          'mains',
          4200,
          'Layered pasta, ragù and béchamel',
          ['pasta', 'beef', 'milk'],
          ['gluten', 'milk'],
        ],
        [
          'Tiramisu',
          'تيراميسو',
          'desserts',
          2200,
          'Classic mascarpone dessert',
          ['mascarpone', 'coffee'],
          ['milk', 'egg', 'gluten'],
        ],
      ],
    },
  ];

  for (const k of kitchens) {
    const cook = await user(k.email, k.cook, ['CUSTOMER', 'COOK']);
    const kitchen = await prisma.kitchen.upsert({
      where: { slug: k.slug },
      update: {},
      create: {
        ownerId: cook.id,
        slug: k.slug,
        name: k.name,
        nameAr: k.nameAr,
        description: `Home-cooked ${k.cuisine} food made fresh to order.`,
        city: 'Riyadh',
        lat: k.lat,
        lng: k.lng,
        verification: 'VERIFIED',
        prepTimeMin: 35,
        minOrderMinor: 2500,
        ratingAvg: 4.6,
        ratingCount: 12,
        searchText: normalizeSearch(`${k.name} ${k.nameAr} ${k.cuisine} Riyadh`),
        cuisines: { create: [{ cuisineId: cuisines[k.cuisine] }] },
        schedule: {
          create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            openMinute: 9 * 60,
            closeMinute: 23 * 60,
          })),
        },
        zones: {
          create: [
            { name: 'Nearby', maxKm: 5, feeMinor: 1000, etaMinutes: 20 },
            { name: 'City', maxKm: 15, feeMinor: 2000, etaMinutes: 40 },
          ],
        },
        verifications: {
          create: { status: 'VERIFIED', reviewerId: admin.id, reviewedAt: new Date() },
        },
      },
    });
    if ((await prisma.menuItem.count({ where: { kitchenId: kitchen.id } })) === 0) {
      for (const [name, nameAr, cat, price, desc, ingredients, allergens] of k.items as [
        string,
        string,
        string,
        number,
        string,
        string[],
        string[],
      ][]) {
        await prisma.menuItem.create({
          data: {
            kitchenId: kitchen.id,
            name,
            nameAr,
            description: desc,
            priceMinor: price,
            categoryId: categories[cat],
            ingredients,
            allergens,
            soldCount: Math.floor(Math.random() * 40),
            searchText: normalizeSearch(`${name} ${nameAr} ${desc} ${ingredients.join(' ')}`),
            optionGroups:
              cat === 'mains'
                ? {
                    create: [
                      {
                        name: 'Portion',
                        nameAr: 'الحجم',
                        type: 'VARIATION',
                        required: true,
                        minSelect: 1,
                        maxSelect: 1,
                        options: {
                          create: [
                            { name: 'Regular', nameAr: 'عادي', priceDeltaMinor: 0 },
                            { name: 'Large', nameAr: 'كبير', priceDeltaMinor: 800 },
                          ],
                        },
                      },
                    ],
                  }
                : undefined,
          },
        });
      }
    }
  }

  if (!(await prisma.coupon.findUnique({ where: { code: 'WELCOME10' } }))) {
    const c = await prisma.coupon.create({
      data: {
        code: 'WELCOME10',
        type: 'PERCENT',
        value: 10,
        maxDiscountMinor: 1500,
        perUserLimit: 1,
      },
    });
    await prisma.promotion.create({
      data: {
        title: '10% off your first order',
        titleAr: 'خصم ١٠٪ على طلبك الأول',
        couponId: c.id,
      },
    });
  }

  // A completed demo order with a review so dashboards and ratings have data.
  if ((await prisma.order.count({ where: { customerId: customerAr.id } })) === 0) {
    const kitchen = await prisma.kitchen.findUniqueOrThrow({
      where: { slug: 'fatima-home-kitchen' },
    });
    const item = await prisma.menuItem.findFirstOrThrow({ where: { kitchenId: kitchen.id } });
    const subtotal = item.priceMinor;
    const tax = Math.round(((subtotal + 1000) * 1500) / 10000);
    const order = await prisma.order.create({
      data: {
        customerId: customerAr.id,
        kitchenId: kitchen.id,
        status: 'COMPLETED',
        fulfillment: 'DELIVERY',
        paymentMethod: 'CASH_ON_DELIVERY',
        currency: 'SAR',
        subtotalMinor: subtotal,
        deliveryFeeMinor: 1000,
        taxMinor: tax,
        totalMinor: subtotal + 1000 + tax,
        commissionBps: 1500,
        idempotencyKey: 'seed-order-1',
        placedAt: new Date(),
        deliveredAt: new Date(),
        items: {
          create: [
            {
              menuItemId: item.id,
              name: item.name,
              unitPriceMinor: item.priceMinor,
              quantity: 1,
              lineTotalMinor: item.priceMinor,
              options: [],
            },
          ],
        },
        history: {
          create: [
            { toStatus: 'PENDING_PAYMENT', actorType: 'CUSTOMER' },
            { fromStatus: 'PENDING_PAYMENT', toStatus: 'PLACED', actorType: 'SYSTEM' },
            { fromStatus: 'PLACED', toStatus: 'COMPLETED', actorType: 'SYSTEM', reason: 'seed' },
          ],
        },
      },
    });
    await prisma.review.create({
      data: {
        orderId: order.id,
        customerId: customerAr.id,
        kitchenId: kitchen.id,
        rating: 5,
        text: 'أطيب كبسة! شكرًا',
      },
    });
  }

  console.log('\nSeed complete. Demo accounts (password: %s)', PASSWORD);
  for (const e of [
    'admin@tablya.test (SUPER_ADMIN)',
    'support@tablya.test',
    'moderator@tablya.test',
    'customer@tablya.test',
    'customer.ar@tablya.test (Arabic)',
    'cook.fatima@tablya.test',
    'cook.layla@tablya.test',
    'cook.marco@tablya.test',
  ])
    console.log('  ' + e);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
