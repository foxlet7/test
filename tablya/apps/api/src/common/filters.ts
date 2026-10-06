import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NestMiddleware,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { map } from 'rxjs';
import { ZodError } from 'zod';

export interface AuthedRequest extends Request {
  user?: { id: string; roles: string[]; sid?: string };
  requestId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AuthedRequest, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    req.requestId =
      typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}

/** Never log secrets: only method, path (no query), status, latency, user id. */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly log = new Logger('http');
  use(req: AuthedRequest, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.log.log(
        JSON.stringify({
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Math.round(ms),
          userId: req.user?.id,
        }),
      );
    });
    next();
  }
}

function isClientHttpError(e: unknown): e is { status?: number; statusCode?: number } {
  const x = e as { status?: number; statusCode?: number; expose?: boolean } | null;
  const s = x?.status ?? x?.statusCode;
  return typeof s === 'number' && s >= 400 && s < 500 && x?.expose === true;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AuthedRequest>();

    let status = 500;
    let code = 'INTERNAL';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Invalid request.';
      details = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests. Try again later.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (body && typeof body === 'object' && body.code) {
        code = body.code;
        message = body.message;
        details = body.details;
      } else {
        code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL';
        message = typeof body === 'string' ? body : Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? message);
        if (status === 413) { code = 'VALIDATION_FAILED'; message = 'Payload too large.'; }
      }
    } else if (isClientHttpError(exception)) {
      // body-parser / multer errors (payload too large, malformed JSON, ...) carry their own 4xx status
      status = exception.status ?? exception.statusCode!;
      code = status === 413 ? 'VALIDATION_FAILED' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
      message = status === 413 ? 'Payload too large.' : 'Malformed request.';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { status = 409; code = 'CONFLICT'; message = 'This record already exists.'; }
      else if (exception.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = 'Not found.'; }
      else if (exception.code === 'P2034') { status = 409; code = 'CONFLICT'; message = 'Concurrent update, please retry.'; }
    }

    if (status >= 500) {
      const err = exception as Error;
      this.log.error(
        JSON.stringify({
          requestId: req.requestId,
          userId: req.user?.id,
          endpoint: `${req.method} ${req.originalUrl.split('?')[0]}`,
          error: err?.message,
          stack: err?.stack,
          at: new Date().toISOString(),
        }),
      );
    }

    res.status(status).json({
      success: false,
      error: { code, message, ...(details ? { details } : {}), requestId: req.requestId },
    });
  }
}

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.path.startsWith('/health') || req.path.startsWith('/readiness'))
      return next.handle();
    return next.handle().pipe(
      map((data) =>
        data && typeof data === 'object' && '__raw' in data
          ? (data as any).__raw
          : { success: true, data: data ?? null },
      ),
    );
  }
}
