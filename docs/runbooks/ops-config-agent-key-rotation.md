# Config Agent key rotation and retention cleanup

Protocol, fingerprint, staging, and snapshot keys are separate systemd credentials;
their bytes and key IDs must never be reused across purposes. Generate each new key
in a mode `0400` root-owned temporary file, atomically install it, and restart only
after the old-key decryption window has been recorded.

The old staging/snapshot key IDs may remain accepted only for the documented
decryption window. New envelopes use the new key. Re-encrypt retained staged or
rollback evidence before removing the old credential. Protocol negotiation must
pass with the expected manifest/catalog versions and digest after restart.

Use this sequence for a rotation; record only key IDs, artifact counts, change
IDs, and reason codes:

1. Freeze draft/save/apply flags and record the current protocol, fingerprint,
   staging, and snapshot key IDs. Confirm the API and agent are on a verified
   release.
2. Generate and install separate replacement credentials. Keep the previous
   staging/snapshot IDs in the agent's accepted-old-key set for the explicitly
   recorded re-encryption window; never make an old protocol or fingerprint
   key a fallback for another purpose.
3. Restart the agent, negotiate capabilities, and run the signed inventory
   smoke test. A mismatch leaves all write flags disabled.
4. Re-encrypt every retained staged envelope and rollback snapshot with the
   new purpose-specific key using the fixed maintenance operation. Verify the
   count of artifacts using each key ID; do not inspect plaintext or ciphertext
   bytes.
5. Run the 24-hour draft/staged cleanup and 30-day successful-snapshot cleanup.
   Retain rollback-failed evidence until its Critical incident is remediated
   and the application block is cleared. Cleanup must be idempotent.
6. After the documented old-key window, verify the old-key artifact count is
   zero, remove old accepted IDs and credentials atomically, restart, and
   repeat capability/inventory negotiation.

If re-encryption, cleanup, or verification fails, restore the previous verified
key set, leave mutation flags disabled, and retain encrypted evidence for the
incident. Never delete evidence with a wildcard or by recursively removing the
state root.

Never print credentials or use them as environment values, arguments, URLs, logs,
metrics, traces, audit metadata, incident text, or shell history. Verify key files
are regular, single-link, root-owned, and mode `0400`; verify the configured paths
and IDs are all distinct. If validation fails, keep mutation flags disabled and
retain the previous verified key set.
