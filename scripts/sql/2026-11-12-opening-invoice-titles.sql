-- Anekio: rename imported old-dues invoices from "Backlog invoice" to "Fees till <Month YYYY>"
-- (the last month they cover), and their line item to "Previous dues".
-- Postgres. Safe to run more than once: only rows still named "Backlog invoice" change.

UPDATE "FeeInvoice"
SET
  "title" = 'Fees till ' || to_char(
    to_date(
      CASE WHEN "generatedThrough" ~ '^\d{4}-\d{2}$' THEN "generatedThrough" ELSE to_char("dueDate", 'YYYY-MM') END,
      'YYYY-MM'
    ),
    'FMMonth YYYY'
  ),
  "linesJson" = replace("linesJson", '"label":"Backlog invoice"', '"label":"Previous dues"')
WHERE "period" = 'OPENING'
  AND "title" = 'Backlog invoice';
