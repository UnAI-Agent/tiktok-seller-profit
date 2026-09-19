/** Minimal DOM shaped like TikTok Seller Center “add product” (for tests). */
export const MOCK_PRODUCT_EDITOR_HTML = `
<header>
  <span>Ailun Screen Protector + Camera Lens Protector for iPhone 16 Pro Max</span>
</header>
<main>
  <section class="field-row">
    <div>Product name</div>
    <textarea>Ailun Screen Protector + Camera Lens Protector for iPhone 16 Pro Max</textarea>
  </section>
  <section class="field-row">
    <div>Category</div>
    <input type="text" value="" />
  </section>
  <section>
    <div>Retail price</div>
    <input type="text" value="29.99" />
  </section>
</main>
`;

/** Name filled, price empty — typical before scrolling to Pricing. */
export const MOCK_PRODUCT_PARTIAL_HTML = `
<main>
  <div class="field-item">
    <span>Product name</span>
    <textarea>Wireless Earbuds Pro</textarea>
  </div>
  <section>
    <div>Sales information</div>
    <div>Retail price</div>
    <input aria-label="Retail price USD" type="text" value="" />
  </section>
</main>
`;

export const MOCK_SELLER_HREF =
  "https://seller-us.tiktok.com/product/create?shop_region=US";
