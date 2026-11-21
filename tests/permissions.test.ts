import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessNav, isStaffRole, type NavItemKey } from '../shared/permissions';

test('staff roles can reach management modules', () => {
  for (const role of ['owner', 'manager', 'advisor']) {
    assert.equal(isStaffRole(role), true, role);
    for (const key of ['customers', 'vehicles', 'mechanics', 'job_cards'] as NavItemKey[]) {
      assert.equal(canAccessNav(role, key), true, `${role}:${key}`);
    }
  }
});

test('technicians are restricted to their workspace and operational views', () => {
  assert.equal(isStaffRole('technician'), false);
  assert.equal(canAccessNav('technician', 'mechanic_workspace'), true);
  assert.equal(canAccessNav('technician', 'dashboard'), true);
  assert.equal(canAccessNav('technician', 'customers'), false);
  assert.equal(canAccessNav('technician', 'mechanics'), false);
});

test('unknown roles and keys fail closed', () => {
  assert.equal(canAccessNav(null, 'dashboard'), false);
  assert.equal(canAccessNav('owner', 'not-a-route' as NavItemKey), false);
});
