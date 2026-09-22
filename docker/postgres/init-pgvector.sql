-- Runs once when the mora-postgres container initializes an empty data directory.
-- Makes the vector type available from day one (Phase A), even though nothing
-- uses it until Phase C (memory / embeddings).
CREATE EXTENSION IF NOT EXISTS vector;
