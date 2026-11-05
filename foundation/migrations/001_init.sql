-- Campus Foundation 1.0, PostgreSQL 16+, initial migration
BEGIN;
CREATE TABLE schools (
 id uuid PRIMARY KEY, code varchar(64) NOT NULL UNIQUE, name varchar(120) NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN ('ACTIVE','DISABLED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE environments (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), code varchar(32) NOT NULL,
 mode varchar(16) NOT NULL CHECK(mode IN ('DEMO','TEST','PRODUCTION')),
 status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,code), UNIQUE(school_id,id)
);
CREATE TABLE users (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), campus_id varchar(64) NOT NULL,
 display_name varchar(100) NOT NULL, status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,campus_id), UNIQUE(school_id,id)
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, user_id uuid NOT NULL, role_code varchar(64) NOT NULL,
 scope_type varchar(32) NOT NULL DEFAULT 'SCHOOL', scope_id varchar(128) NOT NULL DEFAULT '*',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),
 UNIQUE(school_id,user_id,role_code,scope_type,scope_id)
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, user_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE,
 active_role varchar(64) NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE identity_mappings (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, user_id uuid NOT NULL, provider varchar(64) NOT NULL,
 subject varchar(128) NOT NULL, status varchar(16) NOT NULL DEFAULT 'ACTIVE',
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id), UNIQUE(school_id,provider,subject)
);
CREATE TABLE adapter_packages (
 id uuid PRIMARY KEY, code varchar(100) NOT NULL, version varchar(32) NOT NULL,
 manifest jsonb NOT NULL, manifest_digest char(64) NOT NULL, status varchar(16) NOT NULL DEFAULT 'DRAFT',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(code,version)
);
CREATE TABLE capability_contracts (
 id uuid PRIMARY KEY, code varchar(140) NOT NULL, version varchar(32) NOT NULL,
 input_schema jsonb NOT NULL, output_schema jsonb NOT NULL, manifest jsonb NOT NULL,
 digest char(64) NOT NULL, status varchar(16) NOT NULL DEFAULT 'DRAFT',
 UNIQUE(code,version)
);
CREATE TABLE services (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, code varchar(100) NOT NULL, name varchar(120) NOT NULL,
 scenario_code varchar(64) NOT NULL, business_owner_id uuid NOT NULL, technical_owner_id uuid NOT NULL,
 authority_policy jsonb NOT NULL, status varchar(20) NOT NULL DEFAULT 'DRAFT'
 CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED')), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,business_owner_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,technical_owner_id) REFERENCES users(school_id,id),
 UNIQUE(school_id,code), UNIQUE(school_id,id)
);
CREATE TABLE connections (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL,
 name varchar(100) NOT NULL, adapter_package_id uuid NOT NULL REFERENCES adapter_packages(id),
 mode varchar(16) NOT NULL CHECK(mode IN ('DEMO','MANUAL','TEST','LIVE')),
 config jsonb NOT NULL, secret_ref varchar(128), status varchar(16) NOT NULL DEFAULT 'DRAFT',
 authorization_expires_at timestamptz, version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id),
 UNIQUE(school_id,environment_id,id)
);
CREATE TABLE capability_bindings (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL,
 contract_id uuid NOT NULL REFERENCES capability_contracts(id), connection_id uuid NOT NULL,
 support varchar(20) NOT NULL CHECK(support IN ('SUPPORTED','CONDITIONAL','UNSUPPORTED','UNVERIFIED')),
 retry_class varchar(40) NOT NULL CHECK(retry_class IN ('READ_SAFE','WRITE_IDEMPOTENT_VERIFIED','QUERY_BEFORE_RETRY','MANUAL_ONLY')),
 mapping jsonb NOT NULL DEFAULT '{}', limitations jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(school_id,environment_id,connection_id) REFERENCES connections(school_id,environment_id,id),
 UNIQUE(school_id,environment_id,contract_id), UNIQUE(school_id,environment_id,id)
);


CREATE TABLE integration_projects (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, service_id uuid NOT NULL,
 stage varchar(32) NOT NULL DEFAULT 'DISCOVERY', working_status varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
 material jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id),
 FOREIGN KEY(school_id,service_id) REFERENCES services(school_id,id), UNIQUE(school_id,environment_id,id)
);
CREATE TABLE gate_reviews (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, project_id uuid NOT NULL,
 gate varchar(32) NOT NULL, decision varchar(16) NOT NULL, actor_id uuid NOT NULL, reason text NOT NULL,
 evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id,project_id) REFERENCES integration_projects(school_id,environment_id,id),
 FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id)
);
CREATE TABLE releases (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, service_id uuid NOT NULL,
 release_number integer NOT NULL, status varchar(24) NOT NULL DEFAULT 'DRAFT'
 CHECK(status IN ('DRAFT','VALIDATED','TEST_PASSED','PENDING_APPROVAL','APPROVED','ACTIVE','SUPERSEDED','REJECTED')),
 definition jsonb NOT NULL, resolved_manifest jsonb, digest char(64), validation_report jsonb,
 created_by uuid NOT NULL, submitted_by uuid, approved_by uuid, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz,
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id),
 FOREIGN KEY(school_id,service_id) REFERENCES services(school_id,id),
 FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id),
 UNIQUE(school_id,environment_id,service_id,release_number), UNIQUE(school_id,environment_id,id)
);
CREATE UNIQUE INDEX one_active_release ON releases(school_id,environment_id,service_id) WHERE status='ACTIVE';
CREATE TABLE test_runs (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, release_id uuid NOT NULL,
 digest char(64) NOT NULL, status varchar(16) NOT NULL CHECK(status IN ('RUNNING','PASSED','FAILED','NOT_RUN')),
 results jsonb NOT NULL DEFAULT '[]', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 FOREIGN KEY(school_id,environment_id,release_id) REFERENCES releases(school_id,environment_id,id),
 FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id)
);
CREATE TABLE process_instances (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, service_id uuid NOT NULL,
 release_id uuid NOT NULL, subject_user_id uuid NOT NULL, status varchar(24) NOT NULL
 CHECK(status IN ('RUNNING','WAITING_TASK','WAITING_OPERATION','WAITING_EVENT','WAITING_TIMER','INCIDENT','COMPLETED','CANCELLED')),
 current_node varchar(64) NOT NULL, context jsonb NOT NULL, step_count integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 FOREIGN KEY(school_id,environment_id,release_id) REFERENCES releases(school_id,environment_id,id),
 FOREIGN KEY(school_id,service_id) REFERENCES services(school_id,id),
 FOREIGN KEY(school_id,subject_user_id) REFERENCES users(school_id,id), UNIQUE(school_id,environment_id,id)
);
CREATE TABLE node_executions (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, instance_id uuid NOT NULL,
 node_id varchar(64) NOT NULL, visit integer NOT NULL DEFAULT 1,
 status varchar(24) NOT NULL, output jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(school_id,environment_id,instance_id) REFERENCES process_instances(school_id,environment_id,id),
 UNIQUE(instance_id,node_id,visit)
);
CREATE TABLE human_tasks (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, instance_id uuid NOT NULL,
 node_execution_id uuid NOT NULL REFERENCES node_executions(id), role_code varchar(64) NOT NULL,
 scope_type varchar(32) NOT NULL, scope_id varchar(128) NOT NULL, assignee_id uuid,
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLAIMED','COMPLETED','CANCELLED')),
 due_at timestamptz, completed_by uuid, output jsonb, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id,instance_id) REFERENCES process_instances(school_id,environment_id,id),
 FOREIGN KEY(school_id,assignee_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,completed_by) REFERENCES users(school_id,id), UNIQUE(node_execution_id)
);
CREATE TABLE operations (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, binding_id uuid NOT NULL,
 instance_id uuid, node_execution_id uuid, subject_user_id uuid NOT NULL, actor_id uuid NOT NULL,
 action_code varchar(140) NOT NULL, business_key varchar(160) NOT NULL,
 idempotency_key varchar(128) NOT NULL, request_hash char(64) NOT NULL, request jsonb NOT NULL,
 binding_snapshot jsonb NOT NULL,
 side_effect varchar(24) NOT NULL CHECK(side_effect IN ('NONE','LOGICAL_WRITE','FINANCIAL','PHYSICAL')),
 retry_class varchar(40) NOT NULL, status varchar(24) NOT NULL
 CHECK(status IN ('CREATED','DISPATCHING','SENT','SUCCEEDED','BUSINESS_REJECTED','TECHNICAL_FAILED','UNKNOWN','CANCELLED_UNSENT')),
 result jsonb, external_id varchar(160), error_class varchar(64), attempts integer NOT NULL DEFAULT 0,
 deadline_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id,binding_id) REFERENCES capability_bindings(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id,instance_id) REFERENCES process_instances(school_id,environment_id,id),
 FOREIGN KEY(school_id,subject_user_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id),
 UNIQUE(school_id,environment_id,action_code,subject_user_id,idempotency_key), UNIQUE(school_id,environment_id,id)
);
CREATE TABLE operation_attempts (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES operations(id), attempt_number integer NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('EXECUTE','QUERY')), status varchar(24) NOT NULL,
 evidence jsonb NOT NULL DEFAULT '{}', started_at timestamptz NOT NULL, ended_at timestamptz,
 UNIQUE(operation_id,attempt_number)
);
CREATE TABLE resources (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL,
 code varchar(100) NOT NULL, resource_type varchar(32) NOT NULL, authority varchar(64) NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'AVAILABLE', config jsonb NOT NULL,
 UNIQUE(school_id,environment_id,code), UNIQUE(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id)
);
CREATE TABLE device_sessions (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, resource_id uuid NOT NULL,
 subject_user_id uuid NOT NULL, start_operation_id uuid NOT NULL, stop_operation_id uuid,
 external_session_id varchar(160), domain_state varchar(24) NOT NULL,
 observation_state varchar(20) NOT NULL DEFAULT 'CURRENT', tariff_snapshot jsonb NOT NULL,
 started_at timestamptz, ended_at timestamptz, last_authority_at timestamptz, version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(school_id,environment_id,resource_id) REFERENCES resources(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id,start_operation_id) REFERENCES operations(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id,stop_operation_id) REFERENCES operations(school_id,environment_id,id),
 FOREIGN KEY(school_id,subject_user_id) REFERENCES users(school_id,id), UNIQUE(school_id,environment_id,id)
);
CREATE UNIQUE INDEX one_unclosed_device_session ON device_sessions(school_id,environment_id,resource_id)
 WHERE domain_state IN ('REQUESTED','STARTING','ACTIVE','STOPPING');
CREATE TABLE meter_readings (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, resource_id uuid NOT NULL,
 session_id uuid, meter_id varchar(100) NOT NULL, meter_epoch varchar(100) NOT NULL,
 measurand varchar(64) NOT NULL, value numeric(24,9) NOT NULL, unit varchar(16) NOT NULL,
 sampled_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), source_sequence bigint,
 source_event_id varchar(160) NOT NULL, quality_flags jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL,
 FOREIGN KEY(school_id,environment_id,resource_id) REFERENCES resources(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id,session_id) REFERENCES device_sessions(school_id,environment_id,id),
 UNIQUE(school_id,environment_id,resource_id,meter_epoch,source_event_id,measurand)
);
CREATE TABLE bills (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, session_id uuid NOT NULL,
 revision integer NOT NULL, status varchar(32) NOT NULL, components jsonb NOT NULL,
 amount_minor bigint, currency char(3) NOT NULL DEFAULT 'CNY', evidence_refs jsonb NOT NULL,
 supersedes_id uuid REFERENCES bills(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id,session_id) REFERENCES device_sessions(school_id,environment_id,id),
 UNIQUE(session_id,revision)
);
CREATE TABLE event_inbox (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, connection_id uuid NOT NULL,
 external_event_id varchar(160) NOT NULL, event_type varchar(140) NOT NULL, aggregate_id varchar(160), aggregate_version bigint,
 payload jsonb NOT NULL, payload_hash char(64) NOT NULL, status varchar(24) NOT NULL DEFAULT 'RECEIVED',
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), error text,
 FOREIGN KEY(school_id,environment_id,connection_id) REFERENCES connections(school_id,environment_id,id),
 UNIQUE(school_id,environment_id,connection_id,external_event_id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL,
 event_key varchar(200) NOT NULL, event_type varchar(140) NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz,
 UNIQUE(school_id,environment_id,event_key),
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id)
);
CREATE TABLE event_subscriptions (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, instance_id uuid NOT NULL,
 node_execution_id uuid NOT NULL REFERENCES node_executions(id), event_type varchar(140) NOT NULL,
 correlation_key varchar(200) NOT NULL, status varchar(16) NOT NULL DEFAULT 'WAITING', deadline_at timestamptz NOT NULL,
 matched_event_id uuid REFERENCES event_inbox(id),
 FOREIGN KEY(school_id,environment_id,instance_id) REFERENCES process_instances(school_id,environment_id,id),
 UNIQUE(node_execution_id)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, job_type varchar(64) NOT NULL,
 dedupe_key varchar(240) NOT NULL, payload jsonb NOT NULL, status varchar(24) NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
 run_at timestamptz NOT NULL DEFAULT now(), locked_by varchar(100), locked_at timestamptz,
 lease_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id),
 UNIQUE(school_id,environment_id,dedupe_key)
);
CREATE INDEX jobs_ready ON jobs(run_at) WHERE status='PENDING';
CREATE TABLE cases (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL,
 operation_id uuid, instance_id uuid, category varchar(64) NOT NULL, status varchar(24) NOT NULL DEFAULT 'OPEN',
 assigned_role varchar(64) NOT NULL, assigned_user_id uuid, reason text NOT NULL, evidence jsonb NOT NULL DEFAULT '[]',
 decision jsonb, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 FOREIGN KEY(school_id,environment_id,operation_id) REFERENCES operations(school_id,environment_id,id),
 FOREIGN KEY(school_id,environment_id,instance_id) REFERENCES process_instances(school_id,environment_id,id),
 FOREIGN KEY(school_id,assigned_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid,
 actor_id uuid, active_role varchar(64) NOT NULL, action varchar(140) NOT NULL,
 resource_type varchar(64) NOT NULL, resource_id varchar(160) NOT NULL, outcome varchar(24) NOT NULL,
 request_id varchar(100) NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id)
);
CREATE TABLE idempotency_records (
 id uuid PRIMARY KEY, school_id uuid NOT NULL, environment_id uuid NOT NULL, user_id uuid NOT NULL,
 operation_name varchar(140) NOT NULL, key varchar(128) NOT NULL, request_hash char(64) NOT NULL,
 response_code integer NOT NULL, response_body jsonb NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(school_id,environment_id) REFERENCES environments(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),
 UNIQUE(school_id,environment_id,user_id,operation_name,key)
);
CREATE INDEX instance_tasks ON human_tasks(school_id,environment_id,status,role_code);
CREATE INDEX operations_unknown ON operations(school_id,environment_id,updated_at) WHERE status='UNKNOWN';
CREATE INDEX meter_session_time ON meter_readings(session_id,sampled_at);
CREATE INDEX audit_school_time ON audit_logs(school_id,created_at DESC);
COMMIT;
