ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1;

ALTER TABLE node_executions ADD UNIQUE(school_id,environment_id,instance_id,id);
ALTER TABLE human_tasks ADD FOREIGN KEY(school_id,environment_id,instance_id,node_execution_id)
  REFERENCES node_executions(school_id,environment_id,instance_id,id);
ALTER TABLE operations ADD FOREIGN KEY(school_id,environment_id,instance_id,node_execution_id)
  REFERENCES node_executions(school_id,environment_id,instance_id,id);
ALTER TABLE event_subscriptions ADD FOREIGN KEY(school_id,environment_id,instance_id,node_execution_id)
  REFERENCES node_executions(school_id,environment_id,instance_id,id);
