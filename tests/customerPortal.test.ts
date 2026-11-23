import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  REPAIR_TRACKING_STAGES,
  customerNotificationTemplate,
  repairStageIndex,
  repairStageLabel,
} from '../shared/customerPortal.ts';
import { splitSqlStatements } from '../server/sqlStatements.ts';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function routeBlock(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is missing`);
  const nextRoute = source.indexOf('\napp.', start + signature.length);
  return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

const serverSource = read('server/index.ts');
const authSource = read('src/components/CustomerAuthPage.tsx');
const portalSource = read('src/components/customer/CustomerPortal.tsx');
const appSource = read('src/App.tsx');
const landingSource = read('src/components/LandingPage.tsx');

test('customer tracking stages use only existing repair statuses', () => {
  assert.deepEqual(REPAIR_TRACKING_STAGES.map((stage) => stage.status), [
    'Received',
    'Awaiting Inspection',
    'Under Inspection',
    'Awaiting Customer Approval',
    'Approved',
    'In Progress',
    'Awaiting Spare Parts',
    'Repair Completed',
    'Ready for Collection',
    'Collected',
  ]);
  for (const stage of REPAIR_TRACKING_STAGES) {
    const template = customerNotificationTemplate(stage.status);
    assert.ok(template, `${stage.status} needs a customer notification template`);
    assert.equal(template.type.length > 0, true);
    assert.equal(template.title.length > 0, true);
    assert.equal(template.message.length > 0, true);
  }
  assert.equal(customerNotificationTemplate('Unknown internal status'), null);
  assert.equal(repairStageLabel(null), 'Not recorded');
  assert.equal(repairStageIndex('In Progress'), 5);
  assert.equal(repairStageIndex('Collected'), 9);
});

test('name-only sign-in issues a customer session without secondary credentials', () => {
  const identityStart = serverSource.indexOf('async function findCustomerByName');
  assert.notEqual(identityStart, -1);
  const identityBlock = serverSource.slice(identityStart, serverSource.indexOf("app.post('/api/customer/auth/name'", identityStart));
  assert.match(identityBlock, /LOWER\(c\.display_name\) = \?/);
  assert.match(identityBlock, /LIMIT 2/);
  assert.match(identityBlock, /createAccountWhenMissing/);
  assert.doesNotMatch(identityBlock, /phone_normalized|email_normalized|code_hash/);

  const nameBlock = routeBlock(serverSource, "app.post('/api/customer/auth/name'");
  assert.match(nameBlock, /limitCustomerNameLogin/);
  assert.match(nameBlock, /requiredText\(body\.name, 'Customer name', 2, 191\)/);
  assert.match(nameBlock, /findCustomerByName\(name, true\)/);
  assert.match(nameBlock, /createCustomerSession/);
  assert.match(nameBlock, /setCustomerAuthCookies/);
  assert.match(nameBlock, /display_name: identity\.displayName/);
  assert.doesNotMatch(nameBlock, /body\.(phone|email|code|username)/);
  assert.doesNotMatch(nameBlock, /\bcode\s*:/);

  const csrfBlock = serverSource.slice(serverSource.indexOf('function csrfProtection'), serverSource.indexOf('const accountQuery'));
  assert.match(csrfBlock, /\/customer\/auth\/name/);
  assert.doesNotMatch(csrfBlock, /\/customer\/auth\/(request-code|verify-code|login|register)/);
  assert.doesNotMatch(serverSource, /request-code|verify-code|one-time|OTP|SMS/i);
});

test('legacy customer secret routes are disabled while staff sign-in remains', () => {
  for (const signature of ["app.post('/api/customer/auth/register'", "app.post('/api/customer/auth/login'"]) {
    const block = routeBlock(serverSource, signature);
    assert.match(block, /status\(410\)/);
    assert.match(block, /registered customer name/);
    assert.doesNotMatch(block, /one-time|OTP|SMS|username and email/i);
    assert.doesNotMatch(block, /derivePassword\(/);
    assert.doesNotMatch(block, /createCustomerSession/);
  }
  assert.match(routeBlock(serverSource, "app.post('/api/auth/login'"), /derivePassword\(/);
  assert.match(routeBlock(serverSource, "app.post('/api/auth/register'"), /derivePassword\(/);
});

test('generic resource routes cannot shadow customer portal routes', () => {
  for (const method of ['get', 'post', 'patch', 'delete']) {
    assert.doesNotMatch(serverSource, new RegExp(`app\\.${method}\\('/api/:resource'`));
    assert.match(serverSource, new RegExp(`app\\.${method}\\('/api/:resource\\(customers\\|vehicles\\|jobs\\)`));
  }
});

test('every customer portal read and write route is customer authenticated and scoped', () => {
  const protectedSignatures = [
    "app.get('/api/customer/dashboard'",
    "app.get('/api/customer/profile'",
    "app.patch('/api/customer/profile'",
    "app.get('/api/customer/jobs'",
    "app.get('/api/customer/jobs/:jobId'",
    "app.get('/api/customer/service-history'",
    "app.get('/api/customer/billing'",
    "app.get('/api/customer/notifications'",
    "app.patch('/api/customer/notifications/read-all'",
    "app.patch('/api/customer/notifications/:id/read'",
  ];
  for (const signature of protectedSignatures) {
    const block = routeBlock(serverSource, signature);
    assert.match(block, /requireCustomerAuth/, `${signature} is not protected`);
    assert.match(block, /customerPortalIdentity\(response\)/, `${signature} does not use the verified identity`);
  }

  const portalStart = serverSource.indexOf('Customer portal: dashboard');
  const portalEnd = serverSource.indexOf('Adaptive learning, workshop intelligence');
  const portal = serverSource.slice(portalStart, portalEnd);
  assert.match(portal, /customer\.customer_id, customer\.workshop_id/);
  assert.match(portal, /customer\.workshop_id, customer\.customer_id/);
  assert.match(portal, /v\.customer_id = \?/);
  assert.match(portal, /workshop_id = \?/);
});

test('customer JWT session id is checked against the session record', () => {
  const tokenStart = serverSource.indexOf('async function issueCustomerTokenPair');
  const tokenBlock = serverSource.slice(tokenStart, serverSource.indexOf('async function createCustomerSession', tokenStart));
  assert.match(tokenBlock, /sid: sessionId/);

  const authStart = serverSource.indexOf('async function validateCustomerAuth');
  const authBlock = serverSource.slice(authStart, serverSource.indexOf('function requireCustomerAuth', authStart));
  assert.match(authBlock, /AND cs\.id = \?/);
  assert.doesNotMatch(authBlock, /AND ca\.id = \?/);

  const refreshBlock = routeBlock(serverSource, "app.post('/api/customer/auth/refresh'");
  assert.match(refreshBlock, /AND cs\.id = \?/);
  assert.doesNotMatch(refreshBlock, /AND ca\.id = \?/);
});

test('repair status transitions create customer-safe notifications', () => {
  const block = serverSource.slice(
    serverSource.indexOf('async function insertRepairStatusHistory'),
    serverSource.indexOf('app.get(', serverSource.indexOf('async function insertRepairStatusHistory'))
  );
  assert.match(block, /createCustomerStatusNotification/);
  const notificationBlock = serverSource.slice(
    serverSource.indexOf('async function createCustomerStatusNotification'),
    serverSource.indexOf('async function insertRepairStatusHistory')
  );
  assert.match(notificationBlock, /customerNotificationTemplate\(status\)/);
  assert.match(notificationBlock, /INSERT IGNORE INTO customer_notifications/);
  assert.match(notificationBlock, /v\.customer_id/);
  assert.match(notificationBlock, /workshop_id/);
});

test('billing and history are derived from recorded workshop values only', () => {
  const billingBlock = routeBlock(serverSource, "app.get('/api/customer/billing'");
  assert.match(billingBlock, /LEFT JOIN payments p/);
  assert.match(billingBlock, /j\.final_amount_cents/);
  assert.match(billingBlock, /j\.estimated_total_cost_cents/);
  assert.match(billingBlock, /job_parts jp/);
  assert.match(billingBlock, /total_source/);
  assert.doesNotMatch(billingBlock, /Math\.random|dummy|mock/i);

  const historyBlock = routeBlock(serverSource, "app.get('/api/customer/service-history'");
  assert.match(historyBlock, /repair_activity_logs/);
  assert.match(historyBlock, /job_parts jp/);
  assert.match(historyBlock, /final_amount_cents/);
});

test('migration 009 is additive and backfills real status history', () => {
  const sql = read('server/migrations/009_customer_portal.sql');
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 5);
  assert.match(sql, /ALTER TABLE customer_accounts ADD COLUMN username/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_notifications/);
  assert.match(sql, /FROM repair_status_history h/);
  assert.match(sql, /JOIN vehicles v ON v\.id = j\.vehicle_id/);
  assert.doesNotMatch(sql, /customer_login_codes/);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});

test('customer sign-in UI asks only for the registered customer name', () => {
  assert.doesNotMatch(authSource, /type=["']password["']/);
  assert.doesNotMatch(authSource, /name=["']password["']/);
  assert.doesNotMatch(authSource, /confirmPassword/);
  assert.doesNotMatch(authSource, /name=["'](email|phone|code|username)["']/);
  assert.doesNotMatch(authSource, /type=["'](email|tel)["']/);
  assert.doesNotMatch(authSource, /one-time|OTP|SMS|6-digit|phone|username/i);
  assert.match(authSource, /name=["']name["']/);
  assert.match(authSource, /Registered customer name/);
  assert.match(authSource, /name\.trim\(\)/);
  assert.match(authSource, /\/api\/customer\/auth\/name/);
  assert.match(authSource, /Continue to portal/);
  assert.match(authSource, /onAuthenticated\(\)/);
});

test('customer portal shell exposes every required section and uses live endpoints', () => {
  for (const label of [
    'Dashboard',
    'My Vehicles',
    'Track Repairs',
    'Service History',
    'Invoices & Payments',
    'Notifications',
    'My Profile',
    'Logout',
    'Welcome back',
    'Not recorded',
  ]) {
    assert.ok(portalSource.includes(label), `${label} is missing from the portal`);
  }
  for (const endpoint of [
    '/api/customer/dashboard',
    '/api/customer/vehicles',
    '/api/customer/jobs',
    '/api/customer/service-history',
    '/api/customer/billing',
    '/api/customer/notifications',
    '/api/customer/profile',
  ]) {
    assert.ok(portalSource.includes(endpoint), `${endpoint} is missing from the portal`);
  }
  assert.match(portalSource, /REPAIR_TRACKING_STAGES/);
  assert.match(portalSource, /Refreshes every 20 seconds/);
  assert.doesNotMatch(portalSource, /Math\.random|dummy|mock|fake/i);
});

test('app restores customer sessions, renders the portal and wires the landing button', () => {
  assert.match(appSource, /import \{ CustomerPortal \}/);
  assert.doesNotMatch(appSource, /CustomerDashboardView/);
  assert.match(appSource, /apiFetch\('\/api\/customer\/auth\/me'\)/);
  assert.match(appSource, /setCurrentView\('customer-dashboard'\)/);
  assert.match(appSource, /<CustomerPortal onLogout=\{handleCustomerSignOut\} \/>/);
  assert.match(appSource, /apiFetch\('\/api\/customer\/auth\/logout'/);

  const buttonStart = landingSource.indexOf('Customer Portal');
  const buttonBlock = landingSource.slice(Math.max(0, buttonStart - 500), buttonStart + 50);
  assert.match(buttonBlock, /onClick=\{onCustomerPortal \?\? onGetStarted\}/);
  assert.doesNotMatch(buttonBlock, /onClick=\{onGetStarted\}/);
});
