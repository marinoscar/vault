import { Injectable } from '@nestjs/common';
import { NodeJobInputError } from '@marinoscar/platform-api/nodes';
import type { NodeJobInputObject, NodeJobInputs } from '@marinoscar/platform-api/nodes';
import type { Job } from '@marinoscar/platform-api/jobs';

/**
 * The node data plane's `NODE_JOB_INPUTS`: which stored object a held job reads.
 *
 * Vault registers no node-eligible job type of its own (every Vault handler is
 * server-only, see AGENTS.md). The one node-eligible type in the graph is the platform's
 * `db.backup.run` (E9.1), which dumps the database and reads NO stored object, so it never
 * asks this adapter for an input. If a node ever holds any other job, the answer is the
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
