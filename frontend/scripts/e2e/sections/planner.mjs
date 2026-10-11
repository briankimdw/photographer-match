// The AI planner service (services/ml, POST /plan) with a signed-in user's token,
// through the app's planEvent(). Skipped with a notice when the service isn't running.
import { assert, eq, skip } from '../lib/harness.mjs'

export default {
  id: 'planner',
  title: 'AI planner endpoint',
  roles: ['clientA'],
  steps: [
    {
      name: 'service is up (/plan/health)',
      run: async (ctx) => {
        const health = await ctx.app.planner.plannerHealth()
        if (!health) {
          ctx.state.plannerDown = true
          skip(`not running at ${ctx.app.planner.ML_URL}. Start it with: cd services/ml && .venv/Scripts/python -m uvicorn app.main:app --port 8000`)
        }
        return `${ctx.app.planner.ML_URL}: ${JSON.stringify(health)}`
      },
    },
    {
      name: 'refuses requests without a token',
      soft: true,
      run: async (ctx) => {
        if (ctx.state.plannerDown) skip('planner not running')
        const res = await fetch(`${ctx.app.planner.ML_URL}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', history: [] }) })
        if (res.ok) skip('PLANNER_DEV_ALLOW_ANON is on in services/ml/.env (dev only), so anonymous calls are allowed')
        eq(res.status, 401, 'status without a token')
        return '401 without a token'
      },
    },
    {
      name: 'planEvent with the client\'s access token',
      timeoutMs: 180_000,
      run: async (ctx) => {
        if (ctx.state.plannerDown) skip('planner not running')
        await ctx.as('clientA')
        const date = ctx.dates.next()
        const plan = await ctx.app.planner.planEvent({ message: `${ctx.tag('test')} A birthday party for 40 guests in Los Angeles on ${date}, budget $3,000. We need catering and a DJ.` })
        assert(plan.brief, 'no brief in the answer')
        assert(Array.isArray(plan.recommendations), 'no recommendations array')
        const options = plan.recommendations.reduce((n, r) => n + r.options.length, 0)
        if (plan.brief.guest_count != null) eq(plan.brief.guest_count, 40, 'guest count understood')
        return `engine ${plan.engine || '?'}: ${plan.brief.event_type || '?'} for ${plan.brief.guest_count ?? '?'} guests, ${plan.recommendations.length} categories / ${options} vendor options, ${plan.budget.length} budget lines`
      },
    },
  ],
}
