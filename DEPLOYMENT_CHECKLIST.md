# Production Deployment Checklist

Use this checklist before deploying Ops Manager to production.

## 1. Environment Configuration

### Supabase
- [ ] Production Supabase project created
- [ ] `NEXT_PUBLIC_SUPABASE_URL` set to production project
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set to production anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (keep secret!)
- [ ] Database migrations applied (`pnpm db:migrate`)
- [ ] RLS policies verified in Supabase dashboard

### Stripe
- [ ] Production Stripe account configured
- [ ] `STRIPE_SECRET_KEY` set (use live key, starts with `sk_live_`)
- [ ] `STRIPE_WEBHOOK_SECRET` set (from webhook endpoint)
- [ ] Webhook endpoint registered: `https://yourdomain.com/api/webhooks/stripe`
- [ ] Webhook events enabled:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [ ] Products and prices created matching `lib/stripe/config.ts`

### Email Ingestion
- [ ] `EMAIL_WEBHOOK_SECRET` set (min 16 characters)
- [ ] `EMAIL_PROVIDER` set (`sendgrid`, `mailgun`, or `postmark`)
- [ ] `EMAIL_DOMAIN` set to your email subdomain
- [ ] Email provider webhook configured:
  - SendGrid: Inbound Parse → `https://yourdomain.com/api/webhooks/email`
  - Mailgun: Routes → Forward to webhook
  - Postmark: Inbound → Webhook URL
- [ ] Email DNS records configured (MX, SPF, DKIM)

### Application
- [ ] `NEXT_PUBLIC_APP_URL` set to production URL
- [ ] `NODE_ENV` = `production`

## 2. Security Hardening

### Secrets Verification
```bash
# Verify no secrets in code
grep -r "sk_live_" --include="*.ts" --include="*.tsx" .
grep -r "whsec_" --include="*.ts" --include="*.tsx" .
grep -r "service_role" --include="*.ts" --include="*.tsx" .
# Should return empty
```

### Dependency Audit
```bash
pnpm audit
# Ensure no critical or high severity in production dependencies
```

### Headers Verification
After deployment, verify security headers:
```bash
curl -I https://yourdomain.com | grep -E "(Strict|X-Frame|X-Content|Content-Security)"
```

Expected:
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'self'; ...
```

## 3. Database Verification

### RLS Check
Connect to Supabase SQL Editor and verify:
```sql
-- Should return all tables with RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND rowsecurity = true;

-- Expected tables:
-- organizations, profiles, audit_logs, org_members, contacts,
-- tasks, agent_runs, approvals, integrations, usage_tracking,
-- email_aliases, inbound_emails, email_webhook_events
```

### Policy Verification
```sql
-- List all RLS policies
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

### Test Tenant Isolation
1. Create two test organizations
2. As User A, try to access User B's data
3. Verify 403/empty results

## 4. Webhook Testing

### Stripe Webhook
1. Use Stripe CLI to test:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```
2. Verify event appears in `billing_events` table
3. Check logs for successful processing

### Email Webhook
1. Send test email to alias address
2. Verify email appears in `inbound_emails` table
3. Check agent run was created
4. Verify idempotency (resend same email = no duplicate)

## 5. Infrastructure

### Vercel/Hosting
- [ ] Production domain configured
- [ ] SSL/TLS certificate active
- [ ] Environment variables set in hosting dashboard
- [ ] Build successful (`pnpm build`)

### DNS
- [ ] A/CNAME records pointing to hosting
- [ ] Email subdomain MX records configured
- [ ] SPF record for email domain
- [ ] DKIM configured with email provider

### Monitoring
- [ ] Error tracking configured (Sentry, etc.)
- [ ] Log aggregation set up
- [ ] Uptime monitoring enabled
- [ ] Alert thresholds defined

## 6. Backup & Recovery

### Database
- [ ] Point-in-time recovery enabled (Supabase Pro)
- [ ] Backup retention period configured
- [ ] Recovery procedure documented and tested

### Secrets
- [ ] All secrets backed up securely (password manager)
- [ ] Key rotation procedure documented
- [ ] Emergency contacts documented

## 7. Compliance

### Data Protection
- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] Cookie consent implemented (if applicable)
- [ ] Data processing addendum ready (for enterprise)

### Access Control
- [ ] Admin access limited to necessary personnel
- [ ] Strong passwords/MFA for admin accounts
- [ ] API key access logged
- [ ] Third-party access reviewed

## 8. Performance

### Caching
- [ ] Next.js static generation working
- [ ] API routes have appropriate cache headers
- [ ] Database queries use indexes

### Load Testing
- [ ] Test expected concurrent users
- [ ] Verify rate limits work under load
- [ ] Check database connection pooling

## 9. Final Checks

### Smoke Tests
- [ ] User signup flow works
- [ ] User login flow works
- [ ] Protected pages require auth
- [ ] Webhook endpoints return 200 on valid requests
- [ ] Webhook endpoints return 401 on invalid signatures
- [ ] Email alias creation works
- [ ] Stripe checkout flow works

### Rollback Plan
- [ ] Previous deployment available for quick rollback
- [ ] Database migration rollback tested
- [ ] Rollback procedure documented

## 10. Go-Live

### Pre-Launch
- [ ] All items above checked
- [ ] Team notified of launch
- [ ] Support channels ready

### Launch
- [ ] Deploy to production
- [ ] Verify all functionality
- [ ] Monitor error rates
- [ ] Check performance metrics

### Post-Launch
- [ ] Monitor for 24 hours
- [ ] Address any issues immediately
- [ ] Document any incidents
- [ ] Celebrate!

---

## Quick Commands Reference

```bash
# Build production bundle
pnpm build

# Run production locally
pnpm start

# Check types
pnpm tsc --noEmit

# Run linter
pnpm lint

# Run tests
pnpm test

# Audit dependencies
pnpm audit

# Apply database migrations
pnpm db:migrate

# Check environment variables
pnpm check-env
```

## Emergency Contacts

| Role | Contact |
|------|---------|
| Engineering Lead | [Add contact] |
| Security Lead | [Add contact] |
| Supabase Support | support@supabase.io |
| Stripe Support | https://support.stripe.com |
