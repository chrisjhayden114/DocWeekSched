-- H-GEN: agenda skeletons generated from the "describe your event" form land in
-- the existing ingest pipeline as runs with a new additive source kind.
ALTER TYPE "AgendaIngestSourceKind" ADD VALUE 'GENERATED';
