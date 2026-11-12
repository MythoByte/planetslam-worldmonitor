import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import YAML from 'yaml';

const source = readFileSync(new URL('../.github/workflows/planetslam-ci.yml', import.meta.url), 'utf8');
const workflow = YAML.parse(source);

describe('PlanetSlam required PR checks', () => {
  it('runs on every PR and main push without enabling scheduled or privileged automation', () => {
    assert.deepEqual(workflow.on, { pull_request: null, push: { branches: ['main'] }, workflow_dispatch: null });
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.ok(!source.includes('secrets.'));
    assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
    assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.run_id/);
  });

  it('keeps stable required check names, pinned actions, Node 24, and credential-free checkouts', () => {
    assert.deepEqual(Object.keys(workflow.jobs), ['validation', 'browser']);
    for (const [id, name] of [['validation', 'PlanetSlam validation'], ['browser', 'PlanetSlam browser']]) {
      const job = workflow.jobs[id!];
      assert.equal(job.name, name);
      assert.equal(job.if, "github.repository == 'MythoByte/planetslam-worldmonitor'");
      assert.equal(job['runs-on'], 'ubuntu-latest');
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20);
      for (const step of job.steps.filter((step: { uses?: string }) => step.uses)) {
        assert.match(step.uses, /^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
      }
      assert.equal(job.steps[0].with['persist-credentials'], false);
      assert.equal(job.steps[1].with['node-version'], '24');
      assert.ok(job.steps.some((step: { run?: string }) => step.run === 'npm ci --ignore-scripts'));
      assert.ok(job.steps.some((step: { run?: string }) => step.run === 'npm run inventory:facts'));
      assert.ok(job.steps.every((step: Record<string, unknown>) => !step['continue-on-error']));
    }
  });

  it('retains the type, persistence, full DOM, documentation, and browser proofs', () => {
    const commands = workflow.jobs.validation.steps.map((step: { run?: string }) => step.run);
    for (const command of ['npm run typecheck', 'npm run typecheck:api', 'npm run typecheck:dom-tests', 'npm run typecheck:e2e',
      'npm run lint:boundaries', 'npm run docs:check', 'npm run generate:check', 'npm run test:dom',
      'node --import tsx --test tests/planetslam-ci-workflow.test.mts tests/tab-store-persist.test.mts']) {
      assert.ok(commands.includes(command), command);
    }
    assert.equal(workflow.jobs.browser.env.VITE_BRAND, 'planetslam');
    assert.equal(workflow.jobs.browser.env.VITE_VARIANT, 'full');
    assert.ok(workflow.jobs.browser.steps.some((step: { run?: string }) =>
      step.run === 'npx playwright test e2e/planetslam-navigation.spec.ts --project=chromium --workers=1'));
  });
});
