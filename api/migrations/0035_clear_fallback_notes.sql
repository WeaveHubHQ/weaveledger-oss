-- The receipt workflow used to write its own diagnostic into receipts.notes
-- whenever the fallback AI provider handled a receipt:
--   "Processed via <provider> fallback (primary error: <raw provider error>)"
-- Notes is the user's field (receipt detail, CSV/PDF export). Remove that text
-- where it is the whole note or the line after a duplicate warning; a note the
-- user wrote or edited does not match these patterns and is left alone.

UPDATE receipts
SET notes = NULL
WHERE notes LIKE 'Processed via % fallback (primary error: %'
  AND instr(notes, char(10)) = 0;

UPDATE receipts
SET notes = substr(notes, 1, instr(notes, char(10) || 'Processed via ') - 1)
WHERE notes LIKE 'Possible duplicate of receipt %'
  AND instr(notes, char(10) || 'Processed via ') > 0
  AND substr(notes, instr(notes, char(10) || 'Processed via ') + 1) LIKE 'Processed via % fallback (primary error: %'
  AND instr(substr(notes, instr(notes, char(10) || 'Processed via ') + 1), char(10)) = 0;
