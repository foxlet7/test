import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Ctx, parse } from '../context';
import { badRequest } from '../errors';
import { fileAppeal, submitRecitation } from '../services/verification';

export function applyUserVerificationRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const deps = { cfg: ctx.cfg, db: ctx.db, store: ctx.store, provider: ctx.provider };

  app.post('/verification/submissions', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: ctx.cfg.evidenceMaxBytes, files: 1 } });
    if (!file) throw badRequest('file_required');
    const logId = (file.fields.logId as { value?: string } | undefined)?.value;
    parse(z.string().uuid(), logId);
    const buf = await file.toBuffer();
    if ((file as any).file?.truncated) throw badRequest('invalid_size');
    const res = await submitRecitation(deps, req.user!.id, logId!, buf, file.mimetype, ctx.now());
    reply.code(201);
    return res;
  });

  app.get('/verification/submissions', async (req) => {
    const r = await db.query(
      `select s.id, s.log_id, s.task_id, s.status, s.created_at, s.decided_at,
              (select status from appeals a where a.submission_id = s.id) appeal_status,
              coalesce(e.deleted_at is null and e.storage_key is not null, false) evidence_stored
         from verification_submissions s left join evidence_objects e on e.id = s.evidence_id
        where s.user_id = $1 order by s.created_at desc`, [req.user!.id]);
    return { submissions: r.rows };
  });

  app.post('/verification/submissions/:id/appeal', async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ message: z.string().max(1000).nullable().optional() }), req.body ?? {});
    return fileAppeal(deps, req.user!.id, id, b.message ?? null, ctx.now());
  });
}
