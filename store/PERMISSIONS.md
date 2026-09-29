# Chrome Web Store permission justifications

- `storage`: saves settings, the account session, and seller cost records on the device. The service worker calls `chrome.storage`.
- `alarms`: refreshes the local seller-performance snapshot and remote config. The service worker calls `chrome.alarms`.
- `scripting`: restores the MarginMark panel after Seller Center navigation. The service worker calls `chrome.scripting`.
- Seller Center host access: reads visible product values and renders local profit guidance on supported seller pages.
- MarginMark API host access: signs users in, checks subscription status, opens Stripe billing, and reads signed remote config.
- `identity` is not requested. Sign-in opens a normal browser tab.
- `unlimitedStorage` is not requested. A local budget of 5,000 products plus 12 months of statement lines stays under the 10 MB `chrome.storage.local` quota.
- Buyer product and search hosts are not requested until saved HTML fixtures exist for those pages.
