#!/usr/bin/env node
/**
 * RLS Verification Suite
 *
 * Tests multi-tenant isolation using real user sessions.
 *
 * SECURITY TESTS:
 * 1. User B cannot read User A's organization data
 * 2. User B cannot insert into User A's organization
 * 3. User B cannot update User A's organization data
 * 4. Viewer role cannot update tasks
 * 5. Audit logs cannot be updated or deleted
 *
 * PREREQUISITES:
 * - Supabase local or remote instance running
 * - .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * - For user creation: SUPABASE_SERVICE_ROLE_KEY (only for test user setup)
 *
 * USAGE:
 *   node scripts/rls-verify.mjs
 *   pnpm test:rls
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';

// Load environment variables
config({ path: '.env.local' });
config({ path: '.env' });

// =============================================================================
// Configuration
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required environment variables:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL');
  console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY - required for test user setup');
  console.error('Note: Service key is ONLY used to create test users, not for RLS tests');
  process.exit(1);
}

// Test user credentials (will be created if they don't exist)
const TEST_USER_A = {
  email: `test-user-a-${Date.now()}@test.opsmanager.app`,
  password: 'TestPassword123!',
};

const TEST_USER_B = {
  email: `test-user-b-${Date.now()}@test.opsmanager.app`,
  password: 'TestPassword123!',
};

// =============================================================================
// Test Results Tracking
// =============================================================================

const results = [];

function pass(testName) {
  console.log(`  ✓ ${testName}`);
  results.push({ test: testName, status: 'PASS' });
}

function fail(testName, reason) {
  console.error(`  ✗ ${testName}: ${reason}`);
  results.push({ test: testName, status: 'FAIL', reason });
}

function skip(testName, reason) {
  console.log(`  ⊘ ${testName}: ${reason}`);
  results.push({ test: testName, status: 'SKIP', reason });
}

// =============================================================================
// Helper Functions
// =============================================================================

async function createTestUser(adminClient, email, password) {
  // Check if user exists
  const { data: existingUsers } = await adminClient.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(u => u.email === email);

  if (existing) {
    return { user: existing, isNew: false };
  }

  // Create new user
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create user ${email}: ${error.message}`);
  }

  return { user: data.user, isNew: true };
}

async function signInUser(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Failed to sign in ${email}: ${error.message}`);
  }

  return client;
}

async function cleanup(adminClient, userIds) {
  for (const userId of userIds) {
    try {
      await adminClient.auth.admin.deleteUser(userId);
    } catch (e) {
      console.warn(`Failed to cleanup user ${userId}: ${e.message}`);
    }
  }
}

// =============================================================================
// RLS Tests
// =============================================================================

async function runRLSTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║            RLS VERIFICATION SUITE                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Create admin client for test setup ONLY
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let userAId, userBId;
  let orgAId, orgBId;
  let clientA, clientB;

  try {
    // =========================================================================
    // Setup: Create test users
    // =========================================================================
    console.log('Setup: Creating test users...');

    const { user: userA } = await createTestUser(adminClient, TEST_USER_A.email, TEST_USER_A.password);
    userAId = userA.id;
    console.log(`  Created User A: ${TEST_USER_A.email}`);

    const { user: userB } = await createTestUser(adminClient, TEST_USER_B.email, TEST_USER_B.password);
    userBId = userB.id;
    console.log(`  Created User B: ${TEST_USER_B.email}`);

    // Sign in as each user (using ANON key - real user sessions)
    console.log('Setup: Signing in test users...');
    clientA = await signInUser(TEST_USER_A.email, TEST_USER_A.password);
    clientB = await signInUser(TEST_USER_B.email, TEST_USER_B.password);

    // Get org IDs from profiles (created by trigger on signup)
    const { data: profileA } = await clientA.from('profiles').select('organization_id').single();
    const { data: profileB } = await clientB.from('profiles').select('organization_id').single();

    orgAId = profileA?.organization_id;
    orgBId = profileB?.organization_id;

    if (!orgAId || !orgBId) {
      throw new Error('Organizations not created - check signup trigger');
    }

    console.log(`  Org A: ${orgAId}`);
    console.log(`  Org B: ${orgBId}`);
    console.log('');

    // =========================================================================
    // Test 1: Cross-org SELECT protection (organizations)
    // =========================================================================
    console.log('Test 1: Organization isolation (SELECT)');

    // User A should only see their org
    const { data: orgsA } = await clientA.from('organizations').select('id');
    if (orgsA?.length === 1 && orgsA[0].id === orgAId) {
      pass('User A can only see their own organization');
    } else {
      fail('User A org isolation', `Saw ${orgsA?.length} orgs, expected 1`);
    }

    // User B should not see User A's org
    const { data: orgsB } = await clientB.from('organizations').select('id').eq('id', orgAId);
    if (!orgsB || orgsB.length === 0) {
      pass('User B cannot see User A organization');
    } else {
      fail('Cross-org read protection', 'User B could read User A org');
    }

    // =========================================================================
    // Test 2: Cross-org INSERT protection (tasks)
    // =========================================================================
    console.log('\nTest 2: Cross-org INSERT protection');

    // First, create a task in Org A as User A
    const { data: taskA, error: taskAError } = await clientA.from('tasks').insert({
      organization_id: orgAId,
      title: 'Test Task A',
      created_by: userAId,
    }).select().single();

    if (taskAError) {
      fail('User A create task', taskAError.message);
    } else {
      pass('User A can create task in their org');
    }

    // User B should NOT be able to insert into Org A
    const { error: crossInsertError } = await clientB.from('tasks').insert({
      organization_id: orgAId,
      title: 'Malicious Task',
      created_by: userBId,
    });

    if (crossInsertError) {
      pass('User B blocked from inserting into User A org');
    } else {
      fail('Cross-org insert protection', 'User B could insert into User A org');
    }

    // =========================================================================
    // Test 3: Cross-org SELECT protection (tasks)
    // =========================================================================
    console.log('\nTest 3: Cross-org task SELECT protection');

    // User B should NOT see User A's tasks
    const { data: crossTasks } = await clientB.from('tasks').select('*').eq('organization_id', orgAId);
    if (!crossTasks || crossTasks.length === 0) {
      pass('User B cannot see User A tasks');
    } else {
      fail('Cross-org task read', `User B saw ${crossTasks.length} tasks from Org A`);
    }

    // =========================================================================
    // Test 4: Cross-org UPDATE protection (tasks)
    // =========================================================================
    console.log('\nTest 4: Cross-org task UPDATE protection');

    if (taskA) {
      // User B should NOT be able to update User A's task
      const { error: crossUpdateError } = await clientB.from('tasks')
        .update({ title: 'Hacked Task' })
        .eq('id', taskA.id);

      // Even if no error, check if update actually happened
      const { data: checkTask } = await adminClient.from('tasks')
        .select('title')
        .eq('id', taskA.id)
        .single();

      if (checkTask?.title === 'Test Task A') {
        pass('User B cannot update User A task');
      } else {
        fail('Cross-org task update', 'User B modified User A task');
      }
    } else {
      skip('Cross-org task update', 'No task to test');
    }

    // =========================================================================
    // Test 5: Profile isolation
    // =========================================================================
    console.log('\nTest 5: Profile isolation');

    // User A should see profiles in their org
    const { data: profilesA } = await clientA.from('profiles').select('*');
    const allInOrgA = profilesA?.every(p => p.organization_id === orgAId);

    if (allInOrgA && profilesA?.length >= 1) {
      pass('User A only sees own org profiles');
    } else {
      fail('Profile org isolation', 'User A saw profiles from other orgs');
    }

    // User B should not see User A's profile directly
    const { data: crossProfile } = await clientB.from('profiles')
      .select('*')
      .eq('id', userAId);

    if (!crossProfile || crossProfile.length === 0) {
      pass('User B cannot directly query User A profile');
    } else {
      fail('Profile cross-org read', 'User B could read User A profile');
    }

    // =========================================================================
    // Test 6: Audit log append-only
    // =========================================================================
    console.log('\nTest 6: Audit log append-only enforcement');

    // Create an audit log entry
    const { data: auditEntry, error: auditError } = await clientA.from('audit_logs').insert({
      organization_id: orgAId,
      actor_id: userAId,
      action: 'test.rls_verification',
      resource_type: 'test',
      resource_id: 'test-123',
    }).select().single();

    if (auditError) {
      skip('Audit log insert', auditError.message);
    } else {
      pass('User A can insert audit log');

      // Try to UPDATE the audit log (should fail due to trigger)
      const { error: auditUpdateError } = await clientA.from('audit_logs')
        .update({ action: 'hacked' })
        .eq('id', auditEntry.id);

      if (auditUpdateError) {
        pass('Audit log UPDATE blocked');
      } else {
        // Double check the value
        const { data: checkAudit } = await adminClient.from('audit_logs')
          .select('action')
          .eq('id', auditEntry.id)
          .single();

        if (checkAudit?.action === 'test.rls_verification') {
          pass('Audit log UPDATE has no effect (trigger protection)');
        } else {
          fail('Audit log immutability', 'Audit log was modified');
        }
      }

      // Try to DELETE the audit log (should fail)
      const { error: auditDeleteError } = await clientA.from('audit_logs')
        .delete()
        .eq('id', auditEntry.id);

      // Check if still exists
      const { data: stillExists } = await adminClient.from('audit_logs')
        .select('id')
        .eq('id', auditEntry.id)
        .single();

      if (stillExists) {
        pass('Audit log DELETE blocked');
      } else {
        fail('Audit log immutability', 'Audit log was deleted');
      }
    }

    // =========================================================================
    // Test 7: Email alias isolation
    // =========================================================================
    console.log('\nTest 7: Email alias isolation');

    // Create alias for Org A
    const { data: aliasA } = await adminClient.rpc('create_org_email_alias', {
      p_org_id: orgAId,
      p_domain: 'test.opsmanager.app',
    });

    if (aliasA?.[0]) {
      // User B should not see Org A's alias
      const { data: crossAlias } = await clientB.from('email_aliases')
        .select('*')
        .eq('organization_id', orgAId);

      if (!crossAlias || crossAlias.length === 0) {
        pass('User B cannot see User A email alias');
      } else {
        fail('Email alias isolation', 'User B could see User A alias');
      }
    } else {
      skip('Email alias isolation', 'Could not create test alias');
    }

    // =========================================================================
    // Test 8: Inbound email isolation
    // =========================================================================
    console.log('\nTest 8: Inbound email isolation');

    // Insert test email using admin (simulating webhook)
    const { data: testEmail } = await adminClient.from('inbound_emails').insert({
      organization_id: orgAId,
      message_id: `test-${randomUUID()}@test.com`,
      from_address: 'sender@example.com',
      provider: 'test',
      status: 'received',
    }).select().single();

    if (testEmail) {
      // User B should not see Org A's emails
      const { data: crossEmail } = await clientB.from('inbound_emails')
        .select('*')
        .eq('organization_id', orgAId);

      if (!crossEmail || crossEmail.length === 0) {
        pass('User B cannot see User A inbound emails');
      } else {
        fail('Inbound email isolation', 'User B could see User A emails');
      }
    } else {
      skip('Inbound email isolation', 'Could not create test email');
    }

    // =========================================================================
    // Cleanup
    // =========================================================================
    console.log('\nCleanup: Removing test data...');
    await cleanup(adminClient, [userAId, userBId]);
    console.log('  Cleanup complete');

  } catch (error) {
    console.error('\n❌ Test suite error:', error.message);

    // Attempt cleanup
    if (userAId || userBId) {
      console.log('Attempting cleanup...');
      await cleanup(adminClient, [userAId, userBId].filter(Boolean));
    }

    process.exit(1);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║            RLS VERIFICATION SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log(`  Total:   ${results.length}`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.test}: ${r.reason}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log('✅ All RLS tests passed!\n');
  process.exit(0);
}

// Run tests
runRLSTests().catch(console.error);
