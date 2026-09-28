const catalog = {
  'chia-seeds': {
    name: 'Chia Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 149, mrp: 179 },
      '450-gm': { weight: '450 gm', price: 249, mrp: 299 },
      '900-gm': { weight: '900 gm', price: 449, mrp: 549 }
    }
  },
  'pumpkin-seeds': {
    name: 'Pumpkin Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 129, mrp: 159 },
      '450-gm': { weight: '450 gm', price: 229, mrp: 279 },
      '900-gm': { weight: '900 gm', price: 399, mrp: 499 }
    }
  },
  'flax-seeds': {
    name: 'Flax Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 119, mrp: 149 },
      '450-gm': { weight: '450 gm', price: 199, mrp: 249 },
      '900-gm': { weight: '900 gm', price: 349, mrp: 449 }
    }
  },
  'fennel-seeds': {
    name: 'Fennel Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 89, mrp: 109 },
      '450-gm': { weight: '450 gm', price: 159, mrp: 199 },
      '900-gm': { weight: '900 gm', price: 289, mrp: 349 }
    }
  },
  'basil-seeds': {
    name: 'Basil Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 99, mrp: 129 },
      '450-gm': { weight: '450 gm', price: 179, mrp: 229 },
      '900-gm': { weight: '900 gm', price: 319, mrp: 399 }
    }
  },
  'sunflower-seeds': {
    name: 'Sunflower Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 109, mrp: 139 },
      '450-gm': { weight: '450 gm', price: 199, mrp: 249 },
      '900-gm': { weight: '900 gm', price: 359, mrp: 449 }
    }
  },
  'watermelon-seeds': {
    name: 'Watermelon Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 119, mrp: 149 },
      '450-gm': { weight: '450 gm', price: 219, mrp: 269 },
      '900-gm': { weight: '900 gm', price: 399, mrp: 499 }
    }
  },
  'mix-seeds': {
    name: 'Mix Seeds',
    variants: {
      '250-gm': { weight: '250 gm', price: 249, mrp: 299 },
      '450-gm': { weight: '450 gm', price: 429, mrp: 499 },
      '900-gm': { weight: '900 gm', price: 799, mrp: 949 }
    }
  },
  'seed-powder': {
    name: 'Seed Powder',
    variants: {
      '250-gm': { weight: '250 gm', price: 199, mrp: 249 },
      '450-gm': { weight: '450 gm', price: 349, mrp: 429 },
      '900-gm': { weight: '900 gm', price: 649, mrp: 799 }
    }
  }
};

function findVariant(variantId) {
  const match = variantId.match(/^(.*)-(250-gm|450-gm|900-gm)$/);
  if (!match) return null;
  const productId = match[1];
  const weightId = match[2];
  const product = catalog[productId];
  const variant = product?.variants[weightId];
  if (!product || !variant) return null;
  return { productId, variantId, name: product.name, ...variant };
}

module.exports = { catalog, findVariant };
