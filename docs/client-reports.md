# Client report delivery and evidence-based service fit

Implemented September 25, 2026. Existing research, PDFs, slide exports, widget lead routing, CRM records, and billing remain separate from this feature.

## Evidence assessment

Open an analysis, then SOW → Assess tier fit. Record the growth objective and supporting discovery evidence for ownership, required responsibility, sponsor, authority, execution, budget, readiness, and capacity.

- Unknown information cannot produce an approved recommendation.
- Public information can be recorded with a URL, but authority and the engagement's actual operating requirements must be client-confirmed.
- The rules select responsibility, not company size: advisory with an existing owner; strategy with existing executive ownership; full fractional for an explicitly delegated executive remit with resources.
- Negative readiness answers block a retainer recommendation.
- Scope suggests lower-end or upper-end consideration, never an exact fee.
- Save draft removes current approval. Approve recommendation makes the client-ready evidence eligible for a future full report snapshot.
- Research references are general evidence, not proof of a prospect's facts or a statistically validated package predictor.
- Model-written SOW recommendations no longer select a package or an ROI scenario. Existing saved ROI data is unchanged; new scenarios retain the explicitly labeled preference / illustrative fallback behavior.

## Publication

On the analysis header choose Publish client report. Select Full or Demo, review the client preview, optionally set an access code (recommended and enabled by default), confirm the exact audience-visible content, and publish.

The full client snapshot contains approved report sections, visuals, the saved content plan, and an approved recommendation if present. It intentionally excludes the operational intake, raw SOW drafts, draft-review notes, and ROI forecasts. The Demo projection stays bounded and excludes the recommendation and full data.

The button is “Discuss your report,” pointing to the existing Brex booking destination:
https://meetings-na2.hubspot.com/kenny-peavy

Publishing does not send an email. Copy and retain the returned link; the raw access token is not stored or recoverable in link history. An access code must be shared separately and is not email identity verification.

## Access lifecycle

- Expiry is ten 24-hour days from publication, enforced on every server access.
- The browser displays the exact deadline in the viewer's local timezone.
- Extend adds ten days from the later of current expiration or now.
- Revoke is irreversible for that link. A new publication is required afterward.
- Already open views recheck the server every 20 seconds and on focus; expiration has a local deadline timer as well.
- Invalid, expired, or revoked links do not expose report metadata or data.
- The expired view offers “Request renewed access” using the same booking page.
- Downloaded files, screenshots, and already received data cannot be retracted.

## Storage and privacy

Supabase migration: `supabase/migrations/20260926_client_reports.sql`.
Tables `tier_assessments` and `report_shares` have RLS enabled and no anon/authenticated read access. Only the backend service role reads or writes them. Development uses SQLite with the same interface.

Tokens contain 256 random bits and only their SHA-256 hashes are stored. They are placed in the URL fragment rather than request paths. Optional codes use salted scrypt hashes. All public data requests use POST, no-store headers, and rate limiting; API payloads are no longer logged. The public page has noindex/noarchive and no-referrer headers and cannot be framed.

Admin operations require the existing authenticated session. Public report access does not create an administrative session. A content fingerprint prevents publishing a snapshot that differs from the preview the user approved.

Review the whole preview before publication: an allowlist excludes private operational fields, but generated client-facing prose still requires human review for factual accuracy, confidentiality, and scope.
