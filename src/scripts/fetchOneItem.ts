import prisma from '../config/db';

const fetchItem = async () => {
  try {
    const product = await prisma.product.findFirst({
      select: { id: true, name: true, marketId: true }
    });
    if (product) {
      console.log('PRODUCT_ID:', product.id, '| NAME:', product.name, '| MARKET:', product.marketId);
    } else {
      console.log('No products found');
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

fetchItem();
