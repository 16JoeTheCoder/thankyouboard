-- Keep all note IDs, revisions and occupied positions on a previously seeded wall.
DROP TRIGGER initialize_wall;
CREATE TABLE notes_growing (
  id TEXT PRIMARY KEY, teacher TEXT NOT NULL, text TEXT NOT NULL,
  slot INTEGER UNIQUE CHECK(slot >= 0), preferredSlot INTEGER CHECK(preferredSlot >= 0),
  visible INTEGER NOT NULL CHECK(visible IN (0,1)), revision INTEGER NOT NULL,
  CHECK ((visible=1)=(slot IS NOT NULL))
);
INSERT INTO notes_growing SELECT * FROM notes;
DROP TABLE notes;
ALTER TABLE notes_growing RENAME TO notes;
DROP TABLE slots;
CREATE TRIGGER initialize_wall BEFORE INSERT ON seed_publish BEGIN
  SELECT CASE WHEN (SELECT seed_hash FROM state WHERE id=1) IS NOT NULL
    AND (SELECT seed_hash FROM state WHERE id=1)<>NEW.fingerprint THEN RAISE(ABORT,'A different seed was already applied') END;
  SELECT CASE WHEN (SELECT seed_hash FROM state WHERE id=1) IS NULL AND (
    (SELECT count(*) FROM notes)>0 OR
    (SELECT count(*) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<500 OR
    (SELECT count(DISTINCT id) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<500 OR
    (SELECT count(DISTINCT teacher) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<>41 OR
    EXISTS(SELECT teacher FROM seed_stage WHERE fingerprint=NEW.fingerprint GROUP BY teacher HAVING count(*)<3)
  ) THEN RAISE(ABORT,'Invalid initial seed or occupied wall') END;
  INSERT INTO notes(id,teacher,text,slot,preferredSlot,visible,revision)
    SELECT id,teacher,text,CASE WHEN idx<500 THEN (idx*137)%500 ELSE idx END,CASE WHEN idx<500 THEN (idx*137)%500 ELSE idx END,1,1 FROM seed_stage
    WHERE fingerprint=NEW.fingerprint AND (SELECT seed_hash FROM state WHERE id=1) IS NULL;
  UPDATE state SET seed_hash=NEW.fingerprint,revision=1 WHERE id=1 AND seed_hash IS NULL;
  DELETE FROM seed_stage WHERE fingerprint=NEW.fingerprint;
  SELECT RAISE(IGNORE);
END;

CREATE TABLE student_submissions (
  id TEXT PRIMARY KEY, teacher TEXT NOT NULL, text TEXT NOT NULL,
  fingerprint TEXT NOT NULL, sender TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  submittedAt INTEGER NOT NULL DEFAULT (unixepoch()), reviewedAt INTEGER,
  reviewer TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX submission_queue ON student_submissions(status, reviewedAt, submittedAt);
CREATE INDEX submission_sender ON student_submissions(sender, submittedAt);
