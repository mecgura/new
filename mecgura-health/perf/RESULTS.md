# Performance results (synthetic data, SQLite, single process)

Data: 20,000 patients, 60,000 appointments, 20,000 opd, 20,000 invoices, 2,00,000 audit, 30,000 notifications, 50,000 events.
Median of 5 runs after one warm-up. Postgres in production will differ; use these as relative signals and regression guards.

| Screen / query | median ms | verdict |
|---|---:|---|
| Patients list (page 1, 20k patients) | 19 | ok |
| Patient search by name prefix | 24 | ok |
| Patient search by code | 37 | ok |
| Appointments calendar (7 days) | 203 | ok |
| Live OPD queue snapshot (today) | 46 | ok |
| Invoices list (page 1, 20k invoices) | 9 | ok |
| Notifications centre (30k rows) | 32 | ok |
| Platform: audit centre (200k rows, page 1) | 6 | ok |
| Platform: audit centre filtered by category | 27 | ok |
| Platform dashboard | 150 | ok |
| Platform analytics | 0 | ok |
| Security Center overview (50k events) | 21 | ok |
| Security events list | 1 | ok |
