PRAGMA foreign_keys = ON;

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	telegram_id TEXT NOT NULL UNIQUE,
	username TEXT,
	first_name TEXT NOT NULL,
	locale TEXT,
	selected_persona_id TEXT,
	selected_topic TEXT,
	state TEXT NOT NULL DEFAULT 'selecting_persona',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usage_limits (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	free_readings_used INTEGER NOT NULL DEFAULT 0 CHECK (free_readings_used >= 0),
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE readings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	persona_id TEXT NOT NULL,
	topic TEXT NOT NULL,
	question TEXT NOT NULL,
	cards_json TEXT NOT NULL,
	result_text TEXT,
	status TEXT NOT NULL CHECK (status IN ('generating', 'completed', 'failed')),
	telegram_update_id INTEGER NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	completed_at TEXT
);

CREATE TABLE messages (
	id TEXT PRIMARY KEY,
	reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
	content TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processed_updates (
	update_id INTEGER PRIMARY KEY,
	status TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed')),
	attempts INTEGER NOT NULL DEFAULT 1,
	error_message TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX readings_user_created_idx ON readings(user_id, created_at DESC);
CREATE INDEX messages_reading_created_idx ON messages(reading_id, created_at);

