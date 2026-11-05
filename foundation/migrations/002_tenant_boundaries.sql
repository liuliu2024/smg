-- Extend the supplied schema without editing its original migration.
ALTER TABLE node_executions ADD UNIQUE(school_id,environment_id,id);
ALTER TABLE event_inbox ADD UNIQUE(school_id,environment_id,id);
ALTER TABLE bills ADD UNIQUE(school_id,environment_id,id);
ALTER TABLE releases ADD UNIQUE(school_id,environment_id,service_id,id);
ALTER TABLE releases ADD COLUMN generation uuid;
ALTER TABLE test_runs ADD COLUMN release_generation uuid;

ALTER TABLE releases
  ADD FOREIGN KEY(school_id,submitted_by) REFERENCES users(school_id,id),
  ADD FOREIGN KEY(school_id,approved_by) REFERENCES users(school_id,id),
  ADD CHECK(submitted_by IS NULL OR approved_by IS NULL OR submitted_by <> approved_by);
ALTER TABLE process_instances
  ADD FOREIGN KEY(school_id,environment_id,service_id,release_id)
  REFERENCES releases(school_id,environment_id,service_id,id);
ALTER TABLE human_tasks ADD FOREIGN KEY(school_id,environment_id,node_execution_id)
  REFERENCES node_executions(school_id,environment_id,id);
ALTER TABLE operations ADD FOREIGN KEY(school_id,environment_id,node_execution_id)
  REFERENCES node_executions(school_id,environment_id,id);
ALTER TABLE event_subscriptions
  ADD FOREIGN KEY(school_id,environment_id,node_execution_id) REFERENCES node_executions(school_id,environment_id,id),
  ADD FOREIGN KEY(school_id,environment_id,matched_event_id) REFERENCES event_inbox(school_id,environment_id,id);
ALTER TABLE bills ADD FOREIGN KEY(school_id,environment_id,supersedes_id)
  REFERENCES bills(school_id,environment_id,id);

CREATE TABLE foundation_installation (
  singleton boolean PRIMARY KEY CHECK(singleton),
  reset_token_hash char(64) NOT NULL
);
CREATE TABLE worker_heartbeats (
  worker_id varchar(100) PRIMARY KEY,
  seen_at timestamptz NOT NULL
);
CREATE TABLE demo_accounts (
  school_id uuid NOT NULL, user_id uuid NOT NULL, account varchar(64) NOT NULL, default_role varchar(64) NOT NULL,
  PRIMARY KEY(school_id,account),
  FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE foundation_demo_seed (
  singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX services_by_school ON services(school_id,code);
