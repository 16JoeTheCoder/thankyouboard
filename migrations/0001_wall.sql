CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, seed_hash TEXT);
INSERT INTO state VALUES (1,0,NULL);
CREATE TABLE slots (slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 499));
WITH RECURSIVE n(v) AS (SELECT 0 UNION ALL SELECT v+1 FROM n WHERE v<499)
INSERT INTO slots SELECT v FROM n;
CREATE TABLE notes (
  id TEXT PRIMARY KEY, teacher TEXT NOT NULL, text TEXT NOT NULL,
  slot INTEGER UNIQUE REFERENCES slots(slot), preferredSlot INTEGER REFERENCES slots(slot),
  visible INTEGER NOT NULL CHECK(visible IN (0,1)), revision INTEGER NOT NULL,
  CHECK ((visible=1)=(slot IS NOT NULL))
);
CREATE TABLE history (
 id INTEGER PRIMARY KEY, noteId TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
 at TEXT NOT NULL, before TEXT, after TEXT
);
CREATE TABLE operations (id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL);
CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE attempts (ip TEXT PRIMARY KEY, until_time INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE assertions (ok INTEGER NOT NULL CHECK(ok=1));

-- The private importer stages small statements, then publishes the entire wall in one transaction.
CREATE TABLE seed_stage (fingerprint TEXT, idx INTEGER, id TEXT, teacher TEXT, text TEXT, PRIMARY KEY(fingerprint,idx));
CREATE TABLE seed_publish (fingerprint TEXT NOT NULL);
CREATE TRIGGER initialize_wall BEFORE INSERT ON seed_publish BEGIN
  SELECT CASE WHEN (SELECT seed_hash FROM state WHERE id=1) IS NOT NULL
    AND (SELECT seed_hash FROM state WHERE id=1)<>NEW.fingerprint THEN RAISE(ABORT,'A different seed was already applied') END;
  SELECT CASE WHEN (SELECT seed_hash FROM state WHERE id=1) IS NULL AND (
    (SELECT count(*) FROM notes)>0 OR
    (SELECT count(*) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<>500 OR
    (SELECT count(DISTINCT id) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<>500 OR
    (SELECT count(DISTINCT teacher) FROM seed_stage WHERE fingerprint=NEW.fingerprint)<>41 OR
    EXISTS(SELECT teacher FROM seed_stage WHERE fingerprint=NEW.fingerprint GROUP BY teacher HAVING count(*)<3)
  ) THEN RAISE(ABORT,'Invalid initial seed or occupied wall') END;
  INSERT INTO notes(id,teacher,text,slot,preferredSlot,visible,revision)
    SELECT id,teacher,text,(idx*137)%500,(idx*137)%500,1,1 FROM seed_stage
    WHERE fingerprint=NEW.fingerprint AND (SELECT seed_hash FROM state WHERE id=1) IS NULL;
  UPDATE state SET seed_hash=NEW.fingerprint,revision=1 WHERE id=1 AND seed_hash IS NULL;
  DELETE FROM seed_stage WHERE fingerprint=NEW.fingerprint;
  SELECT RAISE(IGNORE);
END;
