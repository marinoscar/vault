// =============================================================================
// The platform-db conformance suite, run against this app (E2.2, #74)
// =============================================================================
//
// Offline: no database. It proves two things an app owes the package:
//   - the raw-SQL index tripwire: every partial or expression index in the
//     platform's migrations is listed in RAW_SQL_INDEXES, none is redeclared
//     with @@unique/@@index in a schema fragment (CLAUDE.md "intentional schema
//     drift"), and
//   - platform.lock: the migrations installed under prisma/migrations are
//     byte-identical to the package's, none missing, none edited.
//
// =============================================================================

import { join } from 'node:path';

import { runDbConformance } from '@marinoscar/platform-db';

runDbConformance({ appRoot: join(__dirname, '..', '..') });
