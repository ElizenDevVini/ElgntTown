-- Eliza Town Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Hubs: Physical locations in the town
CREATE TABLE hubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL, -- 'work', 'social', 'deploy'
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,
  position_z FLOAT NOT NULL DEFAULT 0,
  capacity INT DEFAULT 4,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agents: AI workers living in the town
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'planner', 'designer', 'coder', 'reviewer'
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  system_prompt TEXT,
  personality JSONB DEFAULT '{}',
  current_hub TEXT REFERENCES hubs(id) DEFAULT 'town_square',
  target_hub TEXT REFERENCES hubs(id),
  status TEXT DEFAULT 'idle', -- 'idle', 'traveling', 'working', 'chatting'
  doing TEXT, -- Current activity description
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  color TEXT DEFAULT '#00ffff',
  avatar_url TEXT,
  wallet_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tasks: User submitted work requests
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT,
  prompt TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'planning', 'in_progress', 'completed', 'failed'
  priority INT DEFAULT 0,
  result TEXT,
  output_files JSONB DEFAULT '[]',
  download_url TEXT,
  preview_url TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Subtasks: Broken down pieces of a task
CREATE TABLE subtasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  agent_type TEXT NOT NULL,
  description TEXT NOT NULL,
  input TEXT,
  output TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'assigned', 'in_progress', 'completed', 'failed'
  sequence INT NOT NULL,
  hub_id TEXT REFERENCES hubs(id),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Messages: Agent to agent communication
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  from_agent_id UUID REFERENCES agents(id),
  to_agent_id UUID REFERENCES agents(id),
  from_agent_type TEXT NOT NULL,
  to_agent_type TEXT,
  message_type TEXT DEFAULT 'saying', -- 'saying', 'thinking', 'action'
  content TEXT NOT NULL,
  hub_id TEXT REFERENCES hubs(id),
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent Memory: Persistent context across tasks
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL, -- 'fact', 'preference', 'skill', 'relationship'
  content TEXT NOT NULL,
  importance FLOAT DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT NOW(),
  accessed_at TIMESTAMP DEFAULT NOW()
);

-- Task Files: Output files from completed tasks
CREATE TABLE task_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  filetype TEXT,
  size_bytes INT,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- OAuth Connections: User service integrations
CREATE TABLE oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'google', 'github', 'slack', 'discord'
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  scopes TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Event Log: Full history of town events
CREATE TABLE event_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  agent_id UUID REFERENCES agents(id),
  task_id UUID REFERENCES tasks(id),
  hub_id TEXT REFERENCES hubs(id),
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_subtasks_status ON subtasks(status);
CREATE INDEX idx_subtasks_agent ON subtasks(agent_id);
CREATE INDEX idx_messages_task ON messages(task_id);
CREATE INDEX idx_messages_from ON messages(from_agent_id);
CREATE INDEX idx_messages_to ON messages(to_agent_id);
CREATE INDEX idx_agent_memory_agent ON agent_memory(agent_id);
CREATE INDEX idx_event_log_type ON event_log(event_type);
CREATE INDEX idx_event_log_created ON event_log(created_at);

-- Seed: Default hubs
INSERT INTO hubs (id, name, description, type, position_x, position_y) VALUES
  ('town_square', 'Town Square', 'Central meeting place for agents', 'social', 0, 0),
  ('planning_room', 'Planning Room', 'Where tasks get broken down', 'work', -5, 3),
  ('design_studio', 'Design Studio', 'Creative decisions happen here', 'work', 5, 3),
  ('coding_desk', 'Coding Desk', 'Where code gets written', 'work', -5, -3),
  ('review_station', 'Review Station', 'Quality checks and feedback', 'work', 5, -3),
  ('deploy_station', 'Deploy Station', 'Ship to production', 'deploy', 0, -5),
  ('tavern', 'The Tavern', 'Casual agent hangout', 'social', -7, 0),
  ('library', 'Library', 'Reference and research', 'work', 7, 0);

-- Seed: Default agents
INSERT INTO agents (name, type, system_prompt, current_hub, color) VALUES
  ('Planner', 'planner', 'You are a task planner. Break down user requests into clear subtasks and assign them to the right agents. Output JSON.', 'town_square', '#00ffff'),
  ('Designer', 'designer', 'You are a UI designer. Make visual decisions about colors, layout, typography, and user experience. Be opinionated.', 'town_square', '#ff00ff'),
  ('Coder', 'coder', 'You are a frontend developer. Write clean, working code. Output only code in markdown blocks with filenames. No explanations unless asked.', 'town_square', '#ffaa00'),
  ('Reviewer', 'reviewer', 'You are a code reviewer. Check for bugs, accessibility issues, and improvements. Be thorough but constructive.', 'town_square', '#00ff00');

-- Function: Update timestamp on agent changes
CREATE OR REPLACE FUNCTION update_agent_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_updated
  BEFORE UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_timestamp();

-- Function: Log events automatically
CREATE OR REPLACE FUNCTION log_agent_event()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.current_hub IS DISTINCT FROM NEW.current_hub THEN
    INSERT INTO event_log (event_type, agent_id, hub_id, payload)
    VALUES (
      CASE 
        WHEN OLD.current_hub IS DISTINCT FROM NEW.current_hub THEN 'agent_move'
        ELSE 'agent_status_change'
      END,
      NEW.id,
      NEW.current_hub,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'old_hub', OLD.current_hub,
        'new_hub', NEW.current_hub,
        'doing', NEW.doing
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_event_logger
  AFTER UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION log_agent_event();
