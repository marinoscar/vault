---
"@marinoscar/vault-web": patch
---

The Secrets list's table layout no longer expects a host `DataTablePreferencesProvider`: without one it takes the platform datatable's default port, the `dataTables` namespace of `/api/user-settings` over the host's client (#153). Docs and the test harness follow; no runtime change for a host that still mounts a provider.
