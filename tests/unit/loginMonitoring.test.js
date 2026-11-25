import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getServerAndDbMetrics,
  getLoginAnalyticsMatrix,
  registerSocketConnection,
  unregisterSocketConnection,
  touchSocketHeartbeat,
  getCpuUsagePercent,
} from '../../src/services/serverMonitoring.service.js';
import { getLoginHistoryListing } from '../../src/services/sessionTracking.service.js';

describe('Login History & Usage – Live Tracking and Server Monitoring Suite', () => {
  test('getCpuUsagePercent returns a valid percentage between 0 and 100', () => {
    const cpu = getCpuUsagePercent();
    assert.equal(typeof cpu, 'number');
    assert.ok(cpu >= 0 && cpu <= 100, `Expected CPU ${cpu} to be between 0 and 100`);
  });

  test('getServerAndDbMetrics returns actual server, memory, database, and concurrency metrics', async () => {
    const metrics = await getServerAndDbMetrics();

    // 1. Server Load (CPU)
    assert.ok(metrics.serverLoad, 'Expected serverLoad object');
    assert.equal(typeof metrics.serverLoad.cpuPercent, 'number');
    assert.ok(metrics.serverLoad.cores > 0, 'Expected positive core count');

    // 2. Memory Usage (RAM)
    assert.ok(metrics.memoryUsage, 'Expected memoryUsage object');
    assert.ok(metrics.memoryUsage.totalBytes > 0, 'Expected positive total RAM');
    assert.ok(metrics.memoryUsage.usedBytes > 0, 'Expected positive used RAM');
    assert.equal(typeof metrics.memoryUsage.formatted, 'string');
    assert.ok(metrics.memoryUsage.percent >= 0 && metrics.memoryUsage.percent <= 100);

    // 3. Database Connections
    assert.ok(metrics.databaseConnections, 'Expected databaseConnections object');
    assert.ok(metrics.databaseConnections.active >= 1, 'Expected at least 1 active DB connection');
    assert.ok(metrics.databaseConnections.max > 0, 'Expected max DB connections > 0');

    // 4. Session & Concurrency
    assert.equal(typeof metrics.activeSessions, 'number');
    assert.equal(typeof metrics.activeUsers, 'number');
    assert.equal(typeof metrics.concurrentUsers, 'number');
    assert.equal(typeof metrics.peakConcurrentUsers, 'number');
    assert.ok(metrics.peakConcurrentUsers >= metrics.concurrentUsers);
  });

  test('getLoginAnalyticsMatrix returns complete analytics across 24 hours, 7 days, trends and companies', async () => {
    const analytics = await getLoginAnalyticsMatrix({ range: '7d' });

    assert.ok(analytics.summary, 'Expected summary object');
    assert.equal(typeof analytics.summary.totalLogins, 'number');
    assert.equal(typeof analytics.summary.uniqueUsers, 'number');
    assert.equal(typeof analytics.summary.peakHour, 'string');
    assert.equal(typeof analytics.summary.peakDay, 'string');

    // Hourly distribution: must have 24 hours (0-23)
    assert.equal(analytics.hourlyDistribution.length, 24, 'Expected 24 hourly buckets');
    assert.equal(analytics.hourlyDistribution[0].hour, 0);
    assert.equal(analytics.hourlyDistribution[23].hour, 23);

    // Daily distribution: must have 7 days
    assert.equal(analytics.dailyDistribution.length, 7, 'Expected 7 days of the week');

    // Trends array
    assert.ok(Array.isArray(analytics.trends));
    assert.ok(analytics.trends.length > 0);

    // Company distribution
    assert.ok(Array.isArray(analytics.companyWise));
  });

  test('getLoginHistoryListing returns true global summaryKpis (not limited to 20-row page)', async () => {
    const result = await getLoginHistoryListing({ page: 1, limit: 10 });

    assert.ok(result.rows, 'Expected rows');
    assert.ok(result.pagination, 'Expected pagination');
    assert.ok(result.summaryKpis, 'Expected summaryKpis');

    // Validate global active sessions count is calculated across database
    assert.equal(typeof result.summaryKpis.totalUsers, 'number');
    assert.equal(typeof result.summaryKpis.activeSessions, 'number');
    assert.equal(typeof result.summaryKpis.blockedCount, 'number');
    assert.equal(typeof result.summaryKpis.totalHours, 'string');
    assert.ok(result.summaryKpis.totalUsers >= result.rows.length);
  });

  test('Socket connection registry tracks active connections and heartbeat', () => {
    const mockSocket = {
      id: 'mock_socket_123',
      user: {
        userId: 'user_test_999',
        tenantId: 'tenant_test_888',
        role: 'PLATFORM_OWNER',
      },
    };

    registerSocketConnection(mockSocket);
    touchSocketHeartbeat(mockSocket.id);
    unregisterSocketConnection(mockSocket.id);
  });
});
