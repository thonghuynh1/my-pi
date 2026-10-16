# Muse public-source check

- User confirmed product URL: https://muse.ai/.
- GET https://muse.ai/ -> 200, title `Muse — Your Personal AI Agent`.
- GET https://muse.ai/sitemap.xml -> 200; lists /, /business, /privacy, /terms, /support. No API docs entry.
- GET https://muse.ai/support -> 200, contact-support form; no usage API docs identified.
- GET https://introducing.muse.ai -> 200, product-design article; no public usage endpoint identified.
- GET /api, /docs, /llms.txt -> 401 unauthenticated. Generic protected paths do not prove a usable API exists.
- https://muse.ai/robots.txt states automated collection requires express written permission; do not recommend account scraping as a supported integration.
- Bounded conclusion: public account-usage API not verified, NOT proof that no private/partner API exists. No account login or authenticated usage request performed.
