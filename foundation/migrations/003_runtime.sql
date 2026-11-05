CREATE TABLE demo_library_titles (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  available integer NOT NULL CHECK (available >= 0),
  FOREIGN KEY (school_id, environment_id) REFERENCES environments(school_id, id),
  UNIQUE (school_id, environment_id, code)
);

-- This is simulator-owned authority data. Runtime operation results are projections of these receipts.
CREATE TABLE demo_adapter_receipts (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  action_code varchar(140) NOT NULL,
  operation_id uuid NOT NULL,
  outcome jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, environment_id, operation_id)
    REFERENCES operations(school_id, environment_id, id),
  UNIQUE (school_id, environment_id, operation_id)
);

CREATE TABLE demo_parcel_pickups (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  parcel_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('ELIGIBLE','UNLOCK_PENDING','OPEN_CONFIRMED','COLLECTED')),
  operation_id uuid,
  FOREIGN KEY (school_id, environment_id, resource_id) REFERENCES resources(school_id, environment_id, id),
  FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id),
  FOREIGN KEY (school_id, environment_id, operation_id) REFERENCES operations(school_id, environment_id, id),
  UNIQUE (school_id, environment_id, parcel_code)
);

CREATE TABLE demo_tariff_quotes (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (school_id, environment_id, resource_id) REFERENCES resources(school_id, environment_id, id),
  FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
);

CREATE UNIQUE INDEX operations_one_per_execution ON operations(node_execution_id) WHERE node_execution_id IS NOT NULL;
CREATE UNIQUE INDEX device_sessions_unique_external ON device_sessions(school_id, environment_id, external_session_id)
  WHERE external_session_id IS NOT NULL;
CREATE UNIQUE INDEX cases_one_open_operation ON cases(school_id, environment_id, operation_id)
  WHERE operation_id IS NOT NULL AND status NOT IN ('RESOLVED','CLOSED');
ALTER TABLE operation_attempts
  ADD COLUMN school_id uuid,
  ADD COLUMN environment_id uuid;
UPDATE operation_attempts a SET school_id=o.school_id, environment_id=o.environment_id
  FROM operations o WHERE o.id=a.operation_id;
ALTER TABLE operation_attempts
  ALTER COLUMN school_id SET NOT NULL,
  ALTER COLUMN environment_id SET NOT NULL,
  ADD CONSTRAINT operation_attempts_tenant_fk FOREIGN KEY (school_id,environment_id,operation_id)
    REFERENCES operations(school_id,environment_id,id);
