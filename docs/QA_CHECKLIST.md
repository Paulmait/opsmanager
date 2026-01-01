# Dashboard UI QA Checklist

## Permissions & Access Control

### Tasks Page (`/tasks`)

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **View tasks** | All org members (viewer, member, admin, owner) can view tasks | |
| **Create task** | All members can create tasks | |
| **Update task status** | All members can update task status | |
| **Delete task** | Only admin/owner can delete tasks | |
| **Cross-org isolation** | User cannot see tasks from other organizations | |
| **No org ID leak** | Task IDs from other orgs not exposed in URL or response | |

### Approvals Page (`/approvals`)

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **View approvals** | All org members can view approvals | |
| **Approve action** | Only admin/owner can approve | |
| **Reject action** | Only admin/owner can reject | |
| **Reason required** | Rejection requires a reason | |
| **Expired approval** | Cannot approve/reject expired approvals | |
| **Already processed** | Cannot re-approve/reject processed approvals | |
| **Action preview** | Shows exactly what will happen before approval | |
| **Cross-org isolation** | User cannot see approvals from other organizations | |

### Audit Page (`/audit`)

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **View audit logs** | All org members can view audit logs | |
| **Export logs** | Only admin/owner can export audit logs | |
| **Append-only** | Audit logs cannot be modified (verify via DB) | |
| **All actions logged** | Approvals, tool executions, settings changes logged | |
| **Cross-org isolation** | User cannot see audit logs from other organizations | |
| **Sensitive data redacted** | Passwords, tokens, etc. not in audit metadata | |

### Settings Page (`/settings`)

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **View settings** | All org members can view settings | |
| **Edit settings** | Only admin/owner can modify settings | |
| **Auto mode safety** | Auto-send requires domain/recipient allowlist | |
| **Rate limits** | Daily limits enforced and displayed | |
| **Settings audit** | Settings changes logged to audit | |

---

## Role-Based UI Gating

### Viewer Role

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| View tasks | Yes | |
| Create task | No (hidden) | |
| View approvals | Yes | |
| Approve/reject | No (hidden) | |
| View audit | Yes | |
| Export audit | No (hidden) | |
| View settings | Yes | |
| Edit settings | No (disabled, message shown) | |

### Member Role

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| View tasks | Yes | |
| Create task | Yes | |
| Delete task | No (hidden) | |
| View approvals | Yes | |
| Approve/reject | No (hidden) | |
| View audit | Yes | |
| Export audit | No | |
| View settings | Yes | |
| Edit settings | No (disabled, message shown) | |

### Admin Role

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| All member permissions | Yes | |
| Delete task | Yes | |
| Approve/reject | Yes | |
| Export audit | Yes | |
| Edit settings | Yes | |

### Owner Role

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| All admin permissions | Yes | |
| Delete organization | Yes (future) | |
| Transfer ownership | Yes (future) | |

---

## Escalation Flows

### Approval Flow

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| Agent creates high-risk plan | Approval request created | |
| Low confidence triggers approval | Approval required when below threshold | |
| Admin approves | Actions execute, status updates | |
| Admin rejects | Actions blocked, reason logged | |
| Approval expires | Status changes to expired | |
| Rate limit hit | Approval succeeds but execution deferred | |

### Auto Mode Escalation

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| Auto-draft always allowed | Drafts created without approval | |
| Auto-send to allowed domain | Email sent without approval | |
| Auto-send to unknown domain | Requires approval | |
| Auto-send exceeds daily limit | Requires approval | |
| Auto-send risk exceeds threshold | Requires approval | |

---

## Security Tests

### Server-Side Verification

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **Client-side org ID manipulation** | Server rejects, uses verified org from session | |
| **Direct API calls** | All endpoints verify auth and org membership | |
| **SQL injection attempts** | Parameterized queries prevent injection | |
| **XSS in task titles** | Content properly escaped | |

### Data Isolation

| Test Case | Expected Behavior | Pass/Fail |
|-----------|------------------|-----------|
| **RLS enforcement** | Query with wrong org returns empty | |
| **Service role bypass** | Only used in server actions, never client | |
| **Cookie tampering** | Invalid org cookie rejected | |

---

## Manual Testing Procedure

### Setup
1. Create two organizations (Org A, Org B)
2. Create users with different roles in each org:
   - Org A: owner, admin, member, viewer
   - Org B: owner

### Cross-Org Isolation Test
1. Log in as Org A owner
2. Create tasks, approvals in Org A
3. Log out, log in as Org B owner
4. Verify Org B user cannot see Org A data
5. Attempt to access Org A resources via direct URLs
6. Verify 403/404 responses

### Role Escalation Test
1. Log in as Org A viewer
2. Attempt to access admin-only features
3. Verify UI hides unauthorized actions
4. Attempt to call server actions directly (via DevTools)
5. Verify server returns permission errors

### Audit Trail Test
1. Perform various actions as different users
2. View audit log
3. Verify all actions logged with correct actor
4. Attempt to modify audit log via DB
5. Verify triggers prevent modification

---

## Notes

- All server actions use `requireActiveOrg()` for auth
- All database queries include org_id filter enforced by RLS
- UI components check role before showing action buttons
- Audit logs are append-only with database triggers
- Auto-send requires explicit allowlist configuration
