/**
 * The `/login` route (E3.3, issue #78): the packaged `LoginPage` with Vault's
 * brand in its slots. The page owns the flow (redirect once signed in, the
 * session-expired notice, one button per provider `GET /api/auth/providers`
 * lists); Vault owns only what identifies the product:
 *
 *   - `Logo`: the Vault mark above the heading. This is the one screen with no
 *     app bar, so it is where the brand identifies itself. Decorative
 *     (`alt=""`): the heading below names the product.
 *   - `Title`: "Sign in to Vault" as the page's `h1`, and the tagline from
 *     `packages/shared/identity.json` (`PRODUCT_TAGLINE`) under it.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { LoginPage as PackagedLoginPage } from '@marinoscar/platform-web/identity/ui';
import type { LoginPageSlots } from '@marinoscar/platform-web/identity/ui';

import { PRODUCT_NAME, PRODUCT_TAGLINE, VAULT_MARK_URL as markUrl } from '@marinoscar/vault-web/brand';

function VaultLogo(): ReactElement {
  return (
    <Box
      component="img"
      src={markUrl}
      alt=""
      width={56}
      height={56}
      data-testid="login-logo"
      sx={{ display: 'block', mx: 'auto', mb: 2, borderRadius: '22%' }}
    />
  );
}

function VaultTitle(): ReactElement {
  return (
    <>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
        Sign in to {PRODUCT_NAME}
      </Typography>
      <Typography sx={{ color: 'text.secondary', mt: 1 }} data-testid="login-tagline">
        {PRODUCT_TAGLINE}
      </Typography>
    </>
  );
}

/** A module constant: the package keys on slot identity. */
export const LOGIN_SLOTS: LoginPageSlots = Object.freeze({ Logo: VaultLogo, Title: VaultTitle });

export default function LoginPage(): ReactElement {
  return <PackagedLoginPage slots={LOGIN_SLOTS} />;
}
