CREATE UNIQUE INDEX connection_secret_reference_unique ON connections(secret_ref) WHERE secret_ref IS NOT NULL;
