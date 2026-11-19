import { DOCUMENT_CHECK_IDS, type DocumentCheckId } from '@marinoscar/vault-contract/secret-types';

import type { CheckId } from './index';

// The contract's catalog names its checks by id (DOCUMENT_CHECK_IDS); this library implements them
// (CheckId). The two lists must stay the same set, or a catalog kind could name a check nobody runs.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const sameIds: Equal<CheckId, DocumentCheckId> = true;

/** Exhaustive over CheckId: a new check id fails to compile here until it is listed. */
const IMPLEMENTED: Record<CheckId, true> = { mrz: true, ssn: true, vin: true };

describe('DOCUMENT_CHECK_IDS (issue #209)', () => {
  it('equals CheckId of the check library', () => {
    expect(sameIds).toBe(true);
    expect([...DOCUMENT_CHECK_IDS].sort()).toEqual(Object.keys(IMPLEMENTED).sort());
  });
});
