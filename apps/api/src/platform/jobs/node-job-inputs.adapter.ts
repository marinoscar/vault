import { Injectable } from '@nestjs/common';
import { NodeJobInputError } from '@marinoscar/platform-api/nodes';
import type { NodeJobInputObject, NodeJobInputs } from '@marinoscar/platform-api/nodes';
import type { Job } from '@marinoscar/platform-api/jobs';

/**
 * The node data plane's `NODE_JOB_INPUTS`: which stored object a held job reads.
 *
 * Vault registers no node-eligible job type (E5.1; every handler is server-only,
 * see AGENTS.md), so a worker node is never handed a job and this is never
 * reached in practice. If a node ever holds a job anyway, the answer is the
 * platform's permanent "no input" failure (HTTP 422), never a guess.
 */
@Injectable()
export class NodeJobInputsAdapter implements NodeJobInputs {
  async resolve(job: Job): Promise<NodeJobInputObject> {
    throw new NodeJobInputError(
      'missing_subject_id',
      `Job type ${job.type} reads no stored object on a worker node`,
      job.id,
      job.subjectId ?? null,
    );
  }
}
