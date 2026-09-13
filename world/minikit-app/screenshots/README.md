# Local UI checks

Captured 2026-09-14 JST from the built Next.js app with no Portal credentials.
These are local UI screenshots, **not Developer Portal setup or World App proof**.
Desktop viewport1864×1003; mobile390×844 has no horizontal overflow.
World App authentication, World ID verification and ping remain disabled;
public config names missing variables without exposing secret values.
The API returns401 for an absent session,403 for another Origin and503 for missing World ID/ping configuration.

- [Desktop](local-unconfigured-desktop.png)
- [Mobile](local-unconfigured-mobile.png)
