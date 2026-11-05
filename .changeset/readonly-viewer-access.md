---
"@pcbjs/cli": patch
"@pcbjs/ui": patch
---

Make read-only access visible, use server-granted permissions for editing and source navigation, and revoke editing on disconnect. Keep repository navigation behind explicit source actions. Preserve remote read-only permissions through tunnels and component proxies, enforce editor HTTP access, and carry configured remote-edit tokens into viewer connections. Keep credentials out of TCP status and HTTP assets, restrict read-only source reads to non-hidden project files, and prevent read-only handshakes from attaching additional projects.
