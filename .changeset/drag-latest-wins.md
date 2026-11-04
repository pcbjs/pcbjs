---
'@pcbjs/ui': patch
---

A drag keeps one `session/edit/update` in flight and sends only the newest value that came while it waited, so a drag faster than the session no longer queues a request per pointer move and its commit follows the last position at once.
