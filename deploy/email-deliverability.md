# Email deliverability (transactional mail)

Transactional emails (verification, password reset, order updates) reach inboxes more reliably when **your sending domain matches DNS authentication** and **message content looks legitimate**. Code handles headers and templates; **you must align SMTP and DNS with whoever manages your domain.**

## DNS checklist (share with your domain or mailbox admin)

1. **Pick one From address for production** — set `EMAIL_FROM` to that exact mailbox or `Display Name <address@yourdomain.com>`. Use the **same domain** in SPF/DKIM/DMARC as appears after `@` in that address.

2. **Add the three record types your SMTP provider gives you** (names vary by provider):
   - **SPF** — authorizes your mail servers to send as your domain.
   - **DKIM** — cryptographic signatures proving messages were not altered.
   - **DMARC** — policy telling receivers what to do when SPF/DKIM do not align.

3. **Send a test** from production config and open **Show original** (Gmail) or **Message headers** (Outlook). Confirm **SPF** and **DKIM** pass (and DMARC aligns once published).

4. **Transactional vs marketing** — account and security mail omit bulk-style list-unsubscribe headers. Marketing-style sends (e.g. bulk announcements) may include a mailto unsubscribe line; a full HTTPS one-click unsubscribe endpoint is not implemented in this codebase.

## Environment variables (application)

| Variable | Purpose |
|----------|---------|
| `EMAIL_FROM` | SMTP From address (should match SPF/DKIM domain). |
| `EMAIL_REPLY_TO` | Optional Reply-To (defaults to `SITE_CONTACT_EMAIL`). |
| `EMAIL_TLS_REJECT_UNAUTHORIZED` | Default strict TLS verification; set to `false` only for local/dev debugging. |
| `SITE_CONTACT_EMAIL` | Support/contact address (footer + reply fallback). |
| `SITE_LEGAL_ENTITY_NAME` | Brand name in headers/footers. |
| `SITE_PUBLIC_PHONE` | Real support phone for footer (omit if none). |
| `SITE_PHYSICAL_ADDRESS` | Optional one-line address for footer legitimacy. |
| `SITE_SOCIAL_*_URL` | Optional social links; unset hides each icon. |

See root `.env.example` for commented placeholders.
