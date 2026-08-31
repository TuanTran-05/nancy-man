# Config Agent key rotation

Protocol, fingerprint, staging, and snapshot keys are separate systemd credentials;
their bytes and key IDs must never be reused across purposes. Generate each new key
in a mode `0400` root-owned temporary file, atomically install it, and restart only
after the old-key decryption window has been recorded.

The old staging/snapshot key IDs may remain accepted only for the documented
decryption window. New envelopes use the new key. Re-encrypt retained staged or
rollback evidence before removing the old credential. Protocol negotiation must
pass with the expected manifest/catalog versions and digest after restart.

Never print credentials or use them as environment values, arguments, URLs, logs,
metrics, traces, audit metadata, incident text, or shell history. Verify key files
are regular, single-link, root-owned, and mode `0400`; verify the configured paths
and IDs are all distinct. If validation fails, keep mutation flags disabled and
retain the previous verified key set.
