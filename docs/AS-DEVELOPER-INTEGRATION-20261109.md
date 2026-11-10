# AS Developer: integration decision (2026-11-09)

## Deployment boundary
- Source: public `direcciones507/ad507-developer`, never the private LeveIA repository.
- Target after acceptance: the **existing** Railway `leveia-staging / ad507-developer` service; do not create a second service.
- Preserve existing Railway domain, environment variables, mounted `/data` volume, SQLite state and rollback source. Do not switch Railway until tested and a consistent backup exists.
- Leave `direcciones507/leveia` and its old agent code untouched.

## Reviewed upstream examples
Source: https://github.com/Arindam200/awesome-ai-apps (MIT repository; verify individual dependencies before adoption).

| Example | Reuse | Decision |
|---|---|---|
| `starter_ai_agents/coding_harness_starter` | bounded inspect-plan-diff-approve-test loop | Adapt concepts to existing Node runtime |
| `advance_ai_agents/coding_agent_harness` | planner, explorer, coder, tester and explicit review gate | Adapt roles; do not install LangGraph, E2B or Nebius by default |
| `mcp_ai_agents/github_mcp_agent` | repository exploration | Use existing GitHub connector and scoped project tokens |
| `simple_ai_agents/human_in_the_loop_agent` | mandatory owner approval | Retain existing approval gate and extend tests |
| `simple_ai_agents/llm_router` | cost-aware routing | Defer; existing transactional DeepSeek caps take precedence |

These are reference implementations, not a drop-in ready-made Railway service. They are Python-based and use providers/sandboxes different from the existing Node 24 controller. Copying them wholesale would create duplicated execution paths and weaken review guarantees.

## Verified existing capabilities
- Node 24 controller, persistent queue, per-project registry, budget limits and simulation provider.
- Private owner password with scrypt, CSRF, secure session cookies and login throttling.
- Repository workspace, human approval before delivery, publisher, tests.
- The existing owner login is **password only**. Email + password is not implemented yet.
- Existing controller has no Docker daemon. Code-changing tasks fail closed when a reviewed isolated executor is unavailable.
- The independent repo's previous GitHub Actions dispatcher is retired; the new CI workflow validates this repository only, and is not an agent executor.

## Acceptance gates
1. CI runs `npm ci --ignore-scripts`, `npm run typecheck`, `npm test` on the public repository and records a passing run.
2. Add private single-owner email + password login without public signup, retaining rate limits, CSRF and secure sessions. Never commit the owner's email/password.
3. Integrate distinct planning, repository exploration, proposed edits and verification into existing engine with tests and review.
4. Establish a bounded, authenticated isolated executor before allowing live code edits; GitHub Actions must not be used as a perpetual agent host.
5. Back up the persistent Railway volume, test startup, health, login, task history and rollback, then switch only the `ad507-developer` service's repository source.
6. Keep live DeepSeek and publishing disabled until explicitly authorized.

## Cost controls
Public GitHub Actions standard hosted CI can avoid private-repository included-minute consumption, subject to GitHub terms and current runner billing. CI must be event-driven, short-lived, non-privileged, with read-only repository permissions. Railway and DeepSeek still have their own costs.
