ALTER TABLE releases ADD COLUMN rollback_source_id uuid;
ALTER TABLE releases ADD FOREIGN KEY(school_id,environment_id,service_id,rollback_source_id)
  REFERENCES releases(school_id,environment_id,service_id,id);
