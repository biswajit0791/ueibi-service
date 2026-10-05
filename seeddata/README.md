# Enterprise Goal & Task Seed System (`seeddata`)

This directory contains deterministic, production-safe seed scripts to populate comprehensive Goals and Tasks for all active users across financial years (`FY 2024-25`, `FY 2025-26`, and `FY 2026-27`).

## Purpose & Overview

When switching between financial years (e.g. `FY 2024-25`, `FY 2025-26`, `FY 2026-27`) in the **Task Board** or **Goal Management** modules, users without historical data would see an empty board (0 tasks).

This seed suite generates:
- **Full Kanban Column Coverage**: Populates `To Do`, `In Progress`, `Dependencies / Hold`, `In Review`, and `Completed` columns.
- **Enterprise Weight Balance**: Every goal has tasks whose weights total **100%**, fully satisfying the `goalWeight.service.js` execution lock.
- **Role & Department Specifics**: Contextual tasks and goals for Engineering, IT, Operations, HR, and Finance.
- **Safe & Idempotent**: Uses deduplication queries on `(tenantId, employeeId, title, financialYear)`. It **never deletes or duplicates** existing records.
- **Milestone & Dependency Integration**: Creates companion dependencies and critical `TaskMilestone` records with watcher notification emails.

---

## Directory Structure

```
seeddata/
├── taskGoalTemplates.js       # Rich Goal & Task templates categorized by dept and FY
├── seedTasksAndGoals.js       # Safe Goal & Task runner with CLI flags and summary reporting
├── appraisalTemplates.js      # Realistic accomplishments, manager feedback & 360 peer reviews
├── seedAppraisalCycles.js     # Enterprise Appraisal Cycle & Review runner (2024 & 2025)
└── README.md                  # Documentation and execution guide
```

---

## Execution Guide

### 1. Dry Run (Test without writing to DB)
```bash
node seeddata/seedTasksAndGoals.js --dry-run
```

### 2. Seed usifdn Tenant (Default)
```bash
npm run seed:tasks-goals
# or
node seeddata/seedTasksAndGoals.js --tenant=usifdn
```

### 3. Seed All Tenants
```bash
npm run seed:tasks-goals:all
# or
node seeddata/seedTasksAndGoals.js --all
```

### 4. Seed Appraisal Cycles & Reviews (2024 & 2025)
```bash
# usifdn tenant (default)
npm run seed:appraisals
# or
node seeddata/seedAppraisalCycles.js --tenant=usifdn

# all tenants
npm run seed:appraisals:all
# or
node seeddata/seedAppraisalCycles.js --all

# dry-run simulation
node seeddata/seedAppraisalCycles.js --dry-run
```

---

## Supported Fields & Statuses

### Goals & Tasks
| Entity | Supported Statuses | Key Fields Populated |
| :--- | :--- | :--- |
| **Goal** | `DRAFT`, `ACTIVE`, `IN_PROGRESS`, `PENDING_MANAGER_REVIEW`, `PENDING_HR_REVIEW`, `COMPLETED` | `title`, `description`, `category`, `priority`, `goalType`, `status`, `financialYear`, `quarter`, `startDate`, `targetDate`, `dueDate`, `progress`, `milestones`, `completedMilestones`, `employeeId`, `createdById` |
| **Task** | `todo`, `in_progress`, `pending_on_others`, `in_review`, `done` | `title`, `description`, `priority`, `status`, `progress`, `startDate`, `dueDate`, `actualStartDate`, `actualCompletionDate`, `financialYear`, `tags`, `weight` (sum = 100%), `dependency`, `isMilestoneTracked`, `goalId`, `employeeId` |
| **TaskMilestone** | `PENDING_APPROVAL`, `APPROVED`, `DONE` | `order`, `title`, `dueDate`, `status`, `isDone`, `watcherEmails` |
| **GoalAssignment**| `ASSIGNED`, `IN_PROGRESS`, `COMPLETED` | `goalId`, `employeeId`, `assignedById`, `status`, `progress` |

### Appraisal Cycles & Performance Reviews
| Entity | Supported Frequencies / Statuses | Key Fields Populated |
| :--- | :--- | :--- |
| **AppraisalCycle** | `ANNUAL`, `QUARTERLY`, `MONTHLY` (`ACTIVE`, `CLOSED`) | `name`, `frequency`, `year` (2024, 2025), `month`, `monthNumber`, `startDate`, `endDate`, `status`, `createdById` |
| **AppraisalParameter** | Active: `true` | `name` (5 standard dimensions), `order`, `isActive` |
| **PerformanceReview** | `DRAFT`, `SUBMITTED`, `MANAGER_REVIEWED`, `COMPLETED` | `reviewType`, `selfAccomplishments`, `selfWeaknesses`, `selfRating`, `selfSubmittedAt`, `managerRemarks`, `managerRating`, `managerSubmittedAt`, `hikePercentage`, `hrSignoffStatus` (`RELEASED`), `hrRemarks`, `hrSignedOffById`, `hrSignedOffAt` |
| **ReviewScore** | 1.0 to 5.0 rating scale | `selfScore`, `managerScore`, `hrScore` |
| **PeerNomination** | `COMPLETED`, `PENDING` | `cycleId`, `revieweeId`, `reviewerId`, `status` |
| **PeerFeedback** | 1.0 to 5.0 rating scale | `rating`, `strengths`, `growthAreas` |
