/**
 * Shared chrome for every EPDEMA transactional email.
 *
 * Why the wrapper:
 *   - Identical layout/typography across the 7 templates we ship today
 *     (was duplicated ~60 lines each: doctype → body → card → eyebrow →
 *     content → footer + an inline `escapeHtml` per file).
 *   - One place to evolve the design (palette tweak, footer copy, dark-mode
 *     CSS) without touching every per-template file.
 *   - Preheader text — the inbox-preview line shown next to the subject in
 *     Gmail/Apple Mail/Outlook. Each template now exposes a `preheader`
 *     arg, and the layout hides it visually with the standard `display:none;
 *     mso-hide:all;` trick so it only shows in the client's preview.
 *
 * Tested in: Gmail web + iOS, Apple Mail (macOS + iOS), Outlook 365 (web).
 *
 * Convention: every per-template file exports `render…Email(args)` that
 * returns `{ subject, html, text }`. The html is produced by passing a
 * partial into `renderEmailLayout()`; the text is hand-written (richer
 * fallbacks than auto-stripped HTML).
 */

export interface EmailLayoutArgs {
  /** Small uppercase line above the title — e.g. "EPDEMA · WEDDING" */
  eyebrow: string;
  /** The big bold headline ("You're invited.", "Reset your password") */
  heading: string;
  /** Inbox-preview text. ~80 chars; never visible in the body. */
  preheader: string;
  /** Main body markup — already-escaped HTML, fully styled. */
  contentHtml: string;
  /** Optional primary CTA — renders the saffron pill button after content. */
  cta?: { label: string; url: string };
  /** Optional small text directly under the CTA (fallback paste-the-link). */
  ctaFootnote?: string;
  /** Optional small disclaimer above the standard footer. */
  belowFooterNote?: string;
}

export function renderEmailLayout({
  eyebrow,
  heading,
  preheader,
  contentHtml,
  cta,
  ctaFootnote,
  belowFooterNote,
}: EmailLayoutArgs): string {
  const year = '2026'; // Bumped on the December release-train run.

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(heading)}</title>
    <style>
      /* Apple Mail + recent Gmail honor prefers-color-scheme. We expose a
         dark-mode variant tuned so the saffron CTA still reads at high
         contrast on the aubergine background. */
      @media (prefers-color-scheme: dark) {
        body, .epd-bg { background:#1A1422 !important; color:#FAF7F2 !important; }
        .epd-card { background:#26203A !important; border-color:#3B3450 !important; }
        .epd-ink { color:#FAF7F2 !important; }
        .epd-soft { color:#B7AEC3 !important; }
        .epd-rule { border-color:#3B3450 !important; }
        .epd-eyebrow { color:#E8A93D !important; }
      }
    </style>
  </head>
  <body class="epd-bg" style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#FAF7F2;color:#1F1230;">
    <!-- Preheader: hidden in body, visible in inbox preview -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FAF7F2;">${escapeHtml(preheader)}</div>
    <div class="epd-card" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E5DED1;border-radius:8px;padding:32px;">
      <p class="epd-eyebrow" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#E8A93D;font-weight:600;margin:0 0 16px;">${escapeHtml(eyebrow)}</p>
      <h1 class="epd-ink" style="font-size:24px;font-weight:700;line-height:1.25;margin:0 0 16px;color:#1F1230;">${escapeHtml(heading)}</h1>
      ${contentHtml}
      ${
        cta
          ? `<p style="margin:24px 0 0;"><a href="${cta.url}" style="display:inline-block;background:#E8A93D;color:#1F1230;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">${escapeHtml(cta.label)}</a></p>`
          : ''
      }
      ${
        cta && ctaFootnote
          ? `<p class="epd-soft" style="font-size:12px;color:#877A91;margin:16px 0 0;line-height:1.5;">${ctaFootnote}<br><a href="${cta.url}" style="color:#4A2B7E;word-break:break-all;">${escapeHtml(cta.url)}</a></p>`
          : ''
      }
      ${
        belowFooterNote
          ? `<hr class="epd-rule" style="border:none;border-top:1px solid #E5DED1;margin:24px 0;">
      <p class="epd-soft" style="font-size:11px;color:#877A91;margin:0 0 16px;line-height:1.5;">${belowFooterNote}</p>`
          : `<hr class="epd-rule" style="border:none;border-top:1px solid #E5DED1;margin:24px 0;">`
      }
      <p class="epd-soft" style="font-size:11px;color:#877A91;margin:0;line-height:1.5;">
        EPDEMA — Plan together. Decide once.<br>
        © ${year} EPDEMA · <a href="https://epdema.com" style="color:#877A91;text-decoration:underline;">epdema.com</a>
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Single shared HTML escape — every template used to inline its own. The
 * old `replace(/'/g, '&#39;')` step is kept because some clients (Outlook
 * older) treat unescaped apostrophes in unquoted attribute values funny.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
