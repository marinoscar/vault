import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Observable } from 'rxjs';

/**
 * Marks every agent API response (success or error) as uncacheable: `Cache-Control: no-store` and
 * `Pragma: no-cache`. The headers are set before the handler runs, so an error response carries them
 * too. A fill response holds a credential; no proxy or client may keep it.
 *
 * @stability experimental
 */
@Injectable()
export class AgentNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    return next.handle();
  }
}
