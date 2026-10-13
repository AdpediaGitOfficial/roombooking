-- Bed swaps move two residents between two beds in one statement; the overlap guard must be
-- checked at the end of the transaction for that. It stays immediate everywhere else.
ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_no_overlap";
ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_no_overlap"
  EXCLUDE USING gist (
    "bedId" WITH =,
    daterange("startDate", COALESCE("endDate", 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" IN ('CONFIRMED', 'CHECKED_IN'))
  DEFERRABLE INITIALLY IMMEDIATE;
