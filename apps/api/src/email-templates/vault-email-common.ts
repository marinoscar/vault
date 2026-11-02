import { html, type SafeHtml } from '@marinoscar/platform-api/email';

/** One row of a detail table. `value` is escaped by the `html` tag. */
export function detailRow(label: string, value: string): SafeHtml {
  return html`<tr>
    <td
      style="padding:6px 16px 6px 0;font-size:14px;line-height:20px;color:#4b5563;white-space:nowrap;vertical-align:top;"
    >
      ${label}
    </td>
    <td style="padding:6px 0;font-size:14px;line-height:20px;color:#1f2937;vertical-align:top;">
      <strong>${value}</strong>
    </td>
  </tr>`;
}

/** An absolute link from the deployment base URL and a root-relative path, or `undefined`. */
export function absoluteLink(appUrl: string | null | undefined, path: string): string | undefined {
  if (!appUrl) return undefined;
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}
