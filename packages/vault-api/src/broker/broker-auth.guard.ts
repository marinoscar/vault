import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';
import { BROKER_ERROR_CODES } from '@marinoscar/vault-contract/broker';
import type { FastifyRequest } from 'fastify';

import { BrokerTokensService } from './broker-tokens.service';
import type { BrokerCaller } from './broker-forward.service';

/** The request property the guard fills with the authenticated {@link BrokerCaller}. */
export const BROKER_CALLER_KEY = 'brokerCaller' as const;

/** A request the guard has authenticated. */
export type BrokerRequest = FastifyRequest & { [BROKER_CALLER_KEY]?: BrokerCaller };

const VBK_BEARER = 'Bearer vbk_';
const PAT_BEARER = 'Bearer pat_';

/**
 * Authentication of `/api/broker/v1/*` (ADR-0006 decision 2). The route is `@Public()` for the
 * platform, so the platform guard is not in play; this guard is the whole of its authentication:
 *
 *   * `Bearer vbk_...`  a broker token: looked up by SHA-256, revoked, expired and inactive-owner
 *                       tokens are one 401. Valid ONLY here: no other route reads a `vbk_` bearer
 *                       (the platform guard sends it to the JWT strategy, which refuses it with 401).
 *   * `Bearer pat_...`  a personal access token, authenticated by the platform's own guard
 *                       (`JwtAuthGuard`), so revocation, expiry and org binding are the platform's.
 *   * `Bearer oat_...`, a session JWT or any other scheme: 403 `BROKER_CREDENTIAL_REFUSED`. The
 *     credential is not looked up, so the answer is the same for a real token and a made-up one.
 *   * no `Authorization`: 401.
 *
 * @stability experimental
 */
@Injectable()
export class BrokerAuthGuard implements CanActivate {
  private platformGuard: Pick<JwtAuthGuard, 'canActivate'> | null = null;

  constructor(
    private readonly tokens: BrokerTokensService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * The platform's guard, built on first use inside this module's injection context (the same
   * context `@Auth()` builds it in), so the package adds no provider for it and a `vbk_` request
   * never touches it.
   */
  private async platform(): Promise<Pick<JwtAuthGuard, 'canActivate'>> {
    this.platformGuard ??= await this.moduleRef.create(JwtAuthGuard);
    return this.platformGuard;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BrokerRequest & { user?: { id?: string }; authCredential?: { kind?: string; tokenId?: string } }>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.trim() === '') throw new UnauthorizedException('Authentication required');

    if (header.startsWith(VBK_BEARER)) {
      const resolved = await this.tokens.resolve(header.slice('Bearer '.length));
      if (!resolved) throw new UnauthorizedException('Invalid or expired broker token');
      request[BROKER_CALLER_KEY] = { kind: 'broker', userId: resolved.userId, tokenId: resolved.tokenId, secretIds: resolved.secretIds };
      return true;
    }

    if (header.startsWith(PAT_BEARER)) {
      await (await this.platform()).canActivate(this.withoutPublicMarker(context));
      const credential = request.authCredential;
      if (credential?.kind !== 'pat' || !request.user?.id || !credential.tokenId) throw this.refused();
      request[BROKER_CALLER_KEY] = { kind: 'pat', userId: request.user.id, tokenId: credential.tokenId, secretIds: [] };
      return true;
    }

    throw this.refused();
  }

  /**
   * The platform guard returns at once for a handler or class marked `@Public()` (and this route is,
   * so no other guard runs on it). Hand it a view of the request whose handler and class carry no
   * marker, so it authenticates the personal access token like it does on every `@Auth()` route.
   */
  private withoutPublicMarker(context: ExecutionContext): ExecutionContext {
    return Object.create(context, {
      getHandler: { value: () => BrokerAuthGuard.prototype.canActivate },
      getClass: { value: () => BrokerAuthGuard },
    }) as ExecutionContext;
  }

  private refused(): ForbiddenException {
    return new ForbiddenException({
      code: BROKER_ERROR_CODES.BROKER_CREDENTIAL_REFUSED,
      message: 'The broker accepts only a broker token (vbk_) or a personal access token (pat_)',
    });
  }
}
