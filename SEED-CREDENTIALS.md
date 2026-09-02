# UEIBI – Seeded User Credentials

> **Seeded on:** 2026-09-02  
> **Tenant:** Acme Corp (`acmecorp.com` · Code: `ACM`)  
> **License Limit:** 50  
> **Master Password (all users):** `password123`

---

## Users

| # | Name              | Email                          | Role         | Status | Notes                        |
|---|-------------------|--------------------------------|--------------|--------|------------------------------|
| 1 | Biswajit HR       | biswajitparida1291@gmail.com   | HR           | ACTIVE | —                            |
| 2 | Biswajit Director | biswajitparida0791@gmail.com   | SUPER_ADMIN  | ACTIVE | Full platform access         |
| 3 | Biswajit Admin    | biswajitparida5@gmail.com      | ADMIN        | ACTIVE | —                            |
| 4 | Biswajit Manager  | manager@acmecorp.com           | MANAGER      | ACTIVE | Dept: Engineering, Band: M1  |
| 5 | Pratik Parida     | pratik@acmecorp.com            | EMPLOYEE     | ACTIVE | Reports to Biswajit Manager  |

---

## Quick Login Reference

```
HR:          biswajitparida1291@gmail.com  / password123
Super Admin: biswajitparida0791@gmail.com  / password123
Admin:       biswajitparida5@gmail.com     / password123
Manager:     manager@acmecorp.com          / password123
Employee:    pratik@acmecorp.com           / password123
```

---

## Re-seed Command

```bash
npm run seed-users
```

> ⚠️ **Security:** Change passwords before deploying to production. These are development-only credentials.
