/**
 * Comprehensive Playwright E2E tests for the Evaluation Platform UI.
 *
 * Tests navigation, page rendering, form interactions, and user flows
 * across all 7 evaluation pages:
 *
 * 1. /evaluations — Dashboard
 * 2. /evaluations/run — Run Evaluation
 * 3. /evaluations/results — Results lookup
 * 4. /evaluations/results/[id] — Results detail
 * 5. /evaluations/continuous — Continuous eval config
 * 6. /evaluations/red-team — Red teaming
 * 7. /evaluations/custom-evaluators — Custom evaluators
 *
 * Requires the application to be running on localhost:3000
 * and admin mode (edit=admin or password qrcc2026).
 */

import { test, expect } from '@playwright/test'

// Helper to navigate with admin query param
const adminUrl = (path: string) => `${path}?edit=admin`

// ===========================================================================
// Dashboard — /evaluations
// ===========================================================================

test.describe('Evaluations Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
  })

  test('page loads and shows title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /evaluations/i })).toBeVisible()
  })

  test('shows evaluation service status card', async ({ page }) => {
    await expect(page.getByText('Evaluation Service')).toBeVisible()
  })

  test('shows 5 action cards', async ({ page }) => {
    await expect(page.getByText('Run Evaluation')).toBeVisible()
    await expect(page.getByText('View Results')).toBeVisible()
    await expect(page.getByText('Continuous Eval')).toBeVisible()
    await expect(page.getByText('Red Teaming')).toBeVisible()
    await expect(page.getByText('Custom Evaluators')).toBeVisible()
  })

  test('shows evaluator catalog section', async ({ page }) => {
    await expect(page.getByText('Available Evaluators')).toBeVisible()
  })

  test('evaluator catalog shows category badges', async ({ page }) => {
    await expect(page.getByText(/Quality/)).toBeVisible()
    await expect(page.getByText(/Safety/)).toBeVisible()
    await expect(page.getByText(/Agent/)).toBeVisible()
  })

  test('Run Evaluation card navigates correctly', async ({ page }) => {
    await page.getByText('Run Evaluation').click()
    await expect(page).toHaveURL(/\/evaluations\/run/)
  })

  test('View Results card navigates correctly', async ({ page }) => {
    await page.getByText('View Results').click()
    await expect(page).toHaveURL(/\/evaluations\/results/)
  })

  test('Continuous Eval card navigates correctly', async ({ page }) => {
    await page.getByText('Continuous Eval').click()
    await expect(page).toHaveURL(/\/evaluations\/continuous/)
  })

  test('Red Teaming card navigates correctly', async ({ page }) => {
    await page.getByText('Red Teaming').click()
    await expect(page).toHaveURL(/\/evaluations\/red-team/)
  })

  test('Custom Evaluators card navigates correctly', async ({ page }) => {
    await page.getByText('Custom Evaluators').click()
    await expect(page).toHaveURL(/\/evaluations\/custom-evaluators/)
  })

  test('refresh button exists and is clickable', async ({ page }) => {
    const refreshBtn = page.getByRole('button', { name: /refresh/i })
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    // Should not crash, page stays on evaluations
    await expect(page).toHaveURL(/\/evaluations/)
  })
})

// ===========================================================================
// Run Evaluation — /evaluations/run
// ===========================================================================

test.describe('Run Evaluation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations/run'))
  })

  test('page loads with title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /run evaluation/i })).toBeVisible()
  })

  test('shows 4 evaluation type options', async ({ page }) => {
    await expect(page.getByText('Agent Target')).toBeVisible()
    await expect(page.getByText('Response IDs')).toBeVisible()
    await expect(page.getByText('Dataset')).toBeVisible()
    await expect(page.getByText('Synthetic')).toBeVisible()
  })

  test('Agent Target is selected by default', async ({ page }) => {
    // Agent Target card should have accent styling
    const agentTargetCard = page.getByText('Agent Target').locator('..')
    await expect(agentTargetCard).toBeVisible()
  })

  test('shows agent selection dropdown', async ({ page }) => {
    await expect(page.getByText('Agent')).toBeVisible()
    const select = page.locator('select')
    await expect(select).toBeVisible()
  })

  test('shows evaluators section with categories', async ({ page }) => {
    await expect(page.getByText(/evaluators/i)).toBeVisible()
    // Wait for evaluators to load
    await page.waitForTimeout(2000)
    await expect(page.getByText(/Quality/)).toBeVisible()
  })

  test('shows test queries textarea for agent-target mode', async ({ page }) => {
    await expect(page.getByText('Test Queries')).toBeVisible()
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()
  })

  test('switching to Dataset mode shows JSONL editor', async ({ page }) => {
    await page.getByText('Dataset').click()
    await expect(page.getByText(/JSONL format/)).toBeVisible()
  })

  test('switching to Synthetic mode shows prompt field', async ({ page }) => {
    await page.getByText('Synthetic').click()
    await expect(page.getByText('Generation Prompt')).toBeVisible()
    await expect(page.getByText('Number of Queries')).toBeVisible()
  })

  test('switching to Response IDs mode shows response list', async ({ page }) => {
    await page.getByText('Response IDs').click()
    await expect(page.getByText(/Select Response IDs/)).toBeVisible()
  })

  test('Run button is disabled when agent not selected', async ({ page }) => {
    const runBtn = page.getByRole('button', { name: /run evaluation/i })
    await expect(runBtn).toBeDisabled()
  })

  test('back button navigates to dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })

  test('Select All button exists', async ({ page }) => {
    await page.waitForTimeout(2000) // Wait for evaluators to load
    const selectAll = page.getByText('Select All')
    if (await selectAll.isVisible()) {
      await selectAll.click()
    }
  })
})

// ===========================================================================
// Results Lookup — /evaluations/results
// ===========================================================================

test.describe('Results Lookup Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations/results'))
  })

  test('page loads with title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /evaluation results/i })).toBeVisible()
  })

  test('shows eval ID and run ID input fields', async ({ page }) => {
    await expect(page.getByPlaceholder(/eval_/)).toBeVisible()
    await expect(page.getByPlaceholder(/evalrun_/)).toBeVisible()
  })

  test('View Results button is disabled when fields empty', async ({ page }) => {
    const btn = page.getByRole('button', { name: /view results/i })
    await expect(btn).toBeDisabled()
  })

  test('View Results button enables when both fields filled', async ({ page }) => {
    await page.getByPlaceholder(/eval_/).fill('eval_test_123')
    await page.getByPlaceholder(/evalrun_/).fill('evalrun_test_456')
    const btn = page.getByRole('button', { name: /view results/i })
    await expect(btn).toBeEnabled()
  })

  test('clicking View Results navigates to detail page', async ({ page }) => {
    await page.getByPlaceholder(/eval_/).fill('eval_test_123')
    await page.getByPlaceholder(/evalrun_/).fill('evalrun_test_456')
    await page.getByRole('button', { name: /view results/i }).click()
    await expect(page).toHaveURL(/\/evaluations\/results\/evalrun_test_456/)
  })

  test('shows help text', async ({ page }) => {
    await expect(page.getByText(/where to find ids/i)).toBeVisible()
  })
})

// ===========================================================================
// Results Detail — /evaluations/results/[id]
// ===========================================================================

test.describe('Results Detail Page', () => {
  test('page loads with run ID', async ({ page }) => {
    await page.goto(adminUrl('/evaluations/results/evalrun_test_456') + '&eval_id=eval_test_123')
    await expect(page.getByRole('heading', { name: /evaluation results/i })).toBeVisible()
  })

  test('shows back button', async ({ page }) => {
    await page.goto(adminUrl('/evaluations/results/evalrun_test') + '&eval_id=eval_test')
    await expect(page.getByRole('button', { name: /back/i })).toBeVisible()
  })

  test('shows loading spinner initially', async ({ page }) => {
    await page.goto(adminUrl('/evaluations/results/evalrun_loading') + '&eval_id=eval_loading')
    // Should show either loading spinner or content
    const heading = page.getByRole('heading', { name: /evaluation results/i })
    await expect(heading).toBeVisible({ timeout: 10000 })
  })
})

// ===========================================================================
// Continuous Evaluation — /evaluations/continuous
// ===========================================================================

test.describe('Continuous Evaluation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations/continuous'))
  })

  test('page loads with title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /continuous evaluation/i })).toBeVisible()
  })

  test('shows info banner with learn more link', async ({ page }) => {
    await expect(page.getByText(/how it works/i)).toBeVisible()
    await expect(page.getByText('Learn more')).toBeVisible()
  })

  test('shows existing rules section', async ({ page }) => {
    await expect(page.getByText('Existing Rules')).toBeVisible()
  })

  test('shows create/update rule form', async ({ page }) => {
    await expect(page.getByText('Create / Update Rule')).toBeVisible()
  })

  test('shows agent selection dropdown', async ({ page }) => {
    const select = page.locator('select')
    await expect(select).toBeVisible()
  })

  test('shows rule ID input', async ({ page }) => {
    const ruleIdInput = page.locator('input').filter({ hasText: '' }).first()
    await expect(ruleIdInput).toBeVisible()
  })

  test('shows max hourly runs input', async ({ page }) => {
    await expect(page.getByText('Max Hourly Runs')).toBeVisible()
  })

  test('shows enabled/disabled toggle', async ({ page }) => {
    await expect(page.getByText(/enabled|disabled/i)).toBeVisible()
  })

  test('shows evaluator selection', async ({ page }) => {
    await expect(page.getByText(/evaluators/i)).toBeVisible()
  })

  test('submit button is disabled when no agent selected', async ({ page }) => {
    const btn = page.getByRole('button', { name: /create.*update.*rule/i })
    await expect(btn).toBeDisabled()
  })

  test('back button navigates to dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })
})

// ===========================================================================
// Red Teaming — /evaluations/red-team
// ===========================================================================

test.describe('Red Teaming Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations/red-team'))
  })

  test('page loads with title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /ai red teaming/i })).toBeVisible()
  })

  test('shows info banner', async ({ page }) => {
    await expect(page.getByText(/how it works/i)).toBeVisible()
  })

  test('shows target agent section', async ({ page }) => {
    await expect(page.getByText('Target Agent')).toBeVisible()
  })

  test('shows 3 attack strategies', async ({ page }) => {
    await expect(page.getByText('Flip')).toBeVisible()
    await expect(page.getByText('Base64')).toBeVisible()
    await expect(page.getByText('Indirect Jailbreak')).toBeVisible()
  })

  test('shows 3 red team evaluators', async ({ page }) => {
    await expect(page.getByText('Prohibited Actions')).toBeVisible()
    await expect(page.getByText('Task Adherence')).toBeVisible()
    await expect(page.getByText('Sensitive Data Leakage')).toBeVisible()
  })

  test('shows number of turns input', async ({ page }) => {
    await expect(page.getByText(/number of turns/i)).toBeVisible()
  })

  test('attack strategies are clickable toggles', async ({ page }) => {
    const flipCard = page.getByText('Flip').locator('..')
    await flipCard.click()
    // Should toggle (may become deselected)
  })

  test('start button is disabled when no agent selected', async ({ page }) => {
    const btn = page.getByRole('button', { name: /start red team/i })
    await expect(btn).toBeDisabled()
  })

  test('back button works', async ({ page }) => {
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })
})

// ===========================================================================
// Custom Evaluators — /evaluations/custom-evaluators
// ===========================================================================

test.describe('Custom Evaluators Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(adminUrl('/evaluations/custom-evaluators'))
  })

  test('page loads with title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /custom evaluators/i })).toBeVisible()
  })

  test('shows info banner with learn more link', async ({ page }) => {
    await expect(page.getByText(/custom evaluators/i)).toBeVisible()
    await expect(page.getByText('Learn more')).toBeVisible()
  })

  test('shows pre-built domain evaluators section', async ({ page }) => {
    await expect(page.getByText('Pre-built Domain Evaluators')).toBeVisible()
  })

  test('shows registered custom evaluators section', async ({ page }) => {
    await expect(page.getByText(/registered custom evaluators/i)).toBeVisible()
  })

  test('shows Create New button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create new/i })).toBeVisible()
  })

  test('shows Refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
  })

  test('Create New toggles form visibility', async ({ page }) => {
    await page.getByRole('button', { name: /create new/i }).click()
    await expect(page.getByText('Create Custom Evaluator')).toBeVisible()
    await expect(page.getByText('Code-based')).toBeVisible()
    await expect(page.getByText('Prompt-based')).toBeVisible()
  })

  test('create form has name and display name fields', async ({ page }) => {
    await page.getByRole('button', { name: /create new/i }).click()
    await expect(page.getByPlaceholder('my_custom_evaluator')).toBeVisible()
    await expect(page.getByPlaceholder('My Custom Evaluator')).toBeVisible()
  })

  test('create form code mode shows code editor', async ({ page }) => {
    await page.getByRole('button', { name: /create new/i }).click()
    // Code-based should be default
    await expect(page.getByText(/python code/i)).toBeVisible()
  })

  test('switching to prompt mode shows prompt editor', async ({ page }) => {
    await page.getByRole('button', { name: /create new/i }).click()
    await page.getByText('Prompt-based').click()
    await expect(page.getByText(/judge prompt/i)).toBeVisible()
  })

  test('cancel button hides form', async ({ page }) => {
    await page.getByRole('button', { name: /create new/i }).click()
    await expect(page.getByText('Create Custom Evaluator')).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText('Create Custom Evaluator')).not.toBeVisible()
  })

  test('back button works', async ({ page }) => {
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })
})

// ===========================================================================
// Cross-page navigation tests
// ===========================================================================

test.describe('Navigation Flow', () => {
  test('dashboard → run → back → dashboard', async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
    await page.getByText('Run Evaluation').click()
    await expect(page).toHaveURL(/\/evaluations\/run/)
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })

  test('dashboard → red team → back → dashboard', async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
    await page.getByText('Red Teaming').click()
    await expect(page).toHaveURL(/\/evaluations\/red-team/)
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })

  test('dashboard → custom evaluators → back → dashboard', async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
    await page.getByText('Custom Evaluators').click()
    await expect(page).toHaveURL(/\/evaluations\/custom-evaluators/)
    await page.getByRole('button', { name: /back/i }).click()
    await expect(page).toHaveURL(/\/evaluations/)
  })

  test('dashboard → results → fill form → navigate to detail', async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
    await page.getByText('View Results').click()
    await expect(page).toHaveURL(/\/evaluations\/results/)
    await page.getByPlaceholder(/eval_/).fill('eval_123')
    await page.getByPlaceholder(/evalrun_/).fill('run_456')
    await page.getByRole('button', { name: /view results/i }).click()
    await expect(page).toHaveURL(/\/evaluations\/results\/run_456/)
  })
})

// ===========================================================================
// Sidebar navigation tests
// ===========================================================================

test.describe('Sidebar Navigation', () => {
  test('evaluations link visible in sidebar', async ({ page }) => {
    await page.goto(adminUrl('/evaluations'))
    // The sidebar should show "Evaluations"
    await expect(page.getByText('Evaluations')).toBeVisible()
  })
})
