# Security policy

Please report vulnerabilities privately to **lumora.web.co@gmail.com** (not in public issues). We aim to reply within 72 hours.

Hosted Looi stores passwords with scrypt, session tokens as SHA-256 hashes, blocks private/internal URLs (SSRF) and rate-limits auth endpoints. Never commit `.env`, keystores or databases.
