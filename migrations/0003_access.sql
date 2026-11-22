-- Council members added from the Access view (read-only council desk access) and app-level settings.
CREATE TABLE council_members (
  email TEXT PRIMARY KEY, addedBy TEXT NOT NULL, addedAt TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedBy TEXT NOT NULL, updatedAt TEXT NOT NULL
);
