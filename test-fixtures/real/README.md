# Real Seller Center fixtures

Scrubbed copies of live TikTok Seller Center pages. Parser tests load each `*.html` and compare it to the sibling `*.expected.json`. Do not commit a file until shop name, email, phone, and address are replaced.

## Capture

Seller Center draws the product table and the edit form with JavaScript after the first HTML arrives. Copying too early, or using **View page source**, saves an empty `<main>` and a loading skeleton. That file cannot be parsed.

1. Open the page and wait until you can see the product title, the ID, and the prices (no skeleton bars).
2. DevTools → **Console**. Paste this and press Enter:

```js
document.body.innerText.includes("1732672081725330342")
```

On the Manage products page and on that product's edit page this must print `true`. If it prints `false`, the product is not in the live DOM yet. Wait and run it again. Do not save the file.

3. When it prints `true`, paste this in the same Console and press Enter. Chrome copies the live page, including open shadow roots:

```js
function serialize(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node;
  let html = "<" + el.tagName.toLowerCase();
  for (const a of el.attributes) {
    html += " " + a.name + '="' + a.value.replace(/"/g, "&quot;") + '"';
  }
  html += ">";
  if (el.shadowRoot) {
    html += '<template shadowrootmode="open">';
    for (const c of el.shadowRoot.childNodes) html += serialize(c);
    html += "</template>";
  }
  for (const c of el.childNodes) html += serialize(c);
  return html + "</" + el.tagName.toLowerCase() + ">";
}
copy(serialize(document.documentElement));
```

4. Paste into `test-fixtures/real/<name>.html` and save. The list page belongs in that folder, not in `test-fixtures/`.
5. Search the saved file for `1732672081725330342`. If it is missing, the file is only the shell. Delete it and repeat from step 1.
6. Copy the address-bar URL into that fixture's `url` field.
7. Fill `<name>.expected.json` with what you see on screen (templates below).
8. Scrub, then tell the assistant the files are in place.

## Scrub

Search the HTML and replace personal data. Keep structure, labels, prices, stock, status, and product IDs.

| Remove | Replace with |
|---|---|
| Shop / seller display name | `SHOP` |
| Email | `seller@example.com` |
| Phone | `000-000-0000` |
| Street, city, postal address | `ADDRESS` |

Also delete any copied value that is a session token, cookie, or `csrf`. Prices and product IDs stay.

## Required files

Save both files for each row. Tests skip a row until both exist.

| # | HTML | Page |
|---|---|---|
| 1 | `manage-products-list.html` | Products → Manage products, **Active** tab |
| 2 | `product-edit-single.html` | Edit page of that product |
| 3 | `product-edit-variants.html` | Edit page of a product with 2+ variants |
| 4 | `product-create-empty.html` | Add products, empty form |
| 5 | `affiliate-commission.html` | Affiliate → commission setup (parser later) |

**Files 1 and 2 are required before parser work starts.**

Use the full product title from the DOM when the UI truncates it with `…`. Performance `--` is `null` (unknown), not `0`. Stock `0` stays `0`.

### 1. `manage-products-list.expected.json`

Today's Active tab: one row, title starting `Ailun Screen Protector + Camera Lens Protector`, ID `1732672081725330342`, Price `$45.00`, Promotion `$36.00`, Stock `0`, Performance `--`.

```json
{
  "page": "manage-products-list",
  "url": "PASTE_ADDRESS_BAR_URL",
  "rows": [
    {
      "productId": "1732672081725330342",
      "title": "PASTE_FULL_TITLE",
      "listPrice": 45,
      "promoPrice": 36,
      "stock": 0,
      "status": "Live",
      "unitsSold": null
    }
  ],
  "importedCount": 1,
  "totalRows": null
}
```

Set `totalRows` to the "Total rows" number when the page shows one. `null` means the page did not show a total. `importedCount` is the number of product rows on this page.

### 2. `product-edit-single.expected.json`

```json
{
  "page": "product-edit-single",
  "url": "PASTE_ADDRESS_BAR_URL",
  "productId": "1732672081725330342",
  "title": "PASTE_FULL_TITLE",
  "listPrice": 45,
  "promoPrice": 36,
  "variants": []
}
```

`variants` stays `[]` when the product has a single price and no variant table. Put a promo price only when the edit page shows one.

### 3. `product-edit-variants.expected.json`

One object per variant row. `skuId` is that variant's SKU or seller SKU; use the variant id shown on the row if there is no SKU text.

```json
{
  "page": "product-edit-variants",
  "url": "PASTE_ADDRESS_BAR_URL",
  "productId": "PASTE_PARENT_PRODUCT_ID",
  "title": "PASTE_FULL_TITLE",
  "listPrice": null,
  "promoPrice": null,
  "variants": [
    {
      "skuId": "PASTE_VARIANT_SKU",
      "title": "PASTE_VARIANT_NAME",
      "listPrice": 0,
      "promoPrice": null,
      "stock": 0
    }
  ]
}
```

### 4. `product-create-empty.expected.json`

```json
{
  "page": "product-create-empty",
  "url": "PASTE_ADDRESS_BAR_URL",
  "productId": null,
  "title": "",
  "listPrice": null,
  "promoPrice": null,
  "variants": []
}
```

### 5. `affiliate-commission.expected.json`

No commission parser yet. List the labels you see so the capture can be checked.

```json
{
  "page": "affiliate-commission",
  "url": "PASTE_ADDRESS_BAR_URL",
  "labels": ["PASTE_VISIBLE_LABEL"]
}
```
