# EduTrack Operations Plane

Independent, self-hosted operations software for `man.thienuy.edu.vn`.

It intentionally has its own accounts, sessions, database, deployment and
secrets.  It is not an administrative module of the EduTrack user application.

The approved architecture and implementation plans live in
`docs/superpowers/`. Production SQL capabilities are disabled by default and
must remain disabled until the disaster-recovery gate has been proved by
measured drills.
