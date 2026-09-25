# Intentionally empty

This directory is deliberately empty. The hand-applied SQL for this project lives in
`../sql/`.

Do not move those files back here. They use a `phaseN_` prefix instead of the CLI's
`<timestamp>_name.sql` format, each one ships its own `_rollback.sql` sibling, and none of them are
recorded in the remote migration history — so `supabase db push` would treat them as pending, apply
them in the wrong order (`phase9` last), and could apply a rollback.

See `../sql/README.md` for the full reasoning and the apply order.
