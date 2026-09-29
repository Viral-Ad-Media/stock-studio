-- Re-letter stored study grades on the calibration-aligned scale (lib/grades.ts
-- LETTERS): 70+ A..B-, 45-69 C+..C-, under 45 D+..F. The app already derives
-- the letter from grade_json.score when rendering; this keeps the stored
-- "overall" consistent for anything reading the raw JSON.
UPDATE stocks.case_studies
SET grade_json = jsonb_set(grade_json, '{overall}', to_jsonb(
  CASE
    WHEN (grade_json->>'score')::numeric >= 90 THEN 'A'
    WHEN (grade_json->>'score')::numeric >= 85 THEN 'A-'
    WHEN (grade_json->>'score')::numeric >= 80 THEN 'B+'
    WHEN (grade_json->>'score')::numeric >= 75 THEN 'B'
    WHEN (grade_json->>'score')::numeric >= 70 THEN 'B-'
    WHEN (grade_json->>'score')::numeric >= 60 THEN 'C+'
    WHEN (grade_json->>'score')::numeric >= 50 THEN 'C'
    WHEN (grade_json->>'score')::numeric >= 45 THEN 'C-'
    WHEN (grade_json->>'score')::numeric >= 40 THEN 'D+'
    WHEN (grade_json->>'score')::numeric >= 35 THEN 'D'
    WHEN (grade_json->>'score')::numeric >= 30 THEN 'D-'
    ELSE 'F'
  END))
WHERE grade_json ? 'score' AND jsonb_typeof(grade_json->'score') = 'number';
