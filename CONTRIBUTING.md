# Contributing to Eliza Town

Thanks for your interest in contributing! This project is actively being built and we welcome help.

## Areas That Need Work

These files have TODO comments and need implementation:

### High Priority

**`src/workers/taskProcessor.js`**
- Implement task queue polling with backoff
- Add proper database locking to prevent race conditions
- Build retry logic with exponential backoff
- Consider migrating to pg-boss for robust queuing

**`src/workers/agentWorker.js`**
- Implement agent memory system (save/load/search)
- Build context assembly from memory + previous outputs
- Add tool execution support
- Handle agent-to-agent chat responses

**`src/utils/files.js`**
- Implement zip packaging
- Add deployment to Vercel/Netlify
- Build cleanup job for old files

### Medium Priority

**`src/utils/pathfinding.js`**
- Implement A* pathfinding with obstacles
- Add path smoothing with Catmull-Rom splines
- Build collision avoidance between agents
- Add spatial indexing (quadtree) for performance

**`src/api/oauth.js`** (needs to be created)
- OAuth flow for Google (Gmail, Drive)
- OAuth flow for GitHub
- OAuth flow for Slack
- Token refresh handling

### Nice to Have

**Frontend improvements**
- Replace placeholder shapes with actual 3D character models
- Add hub buildings/structures
- Improve speech bubble positioning
- Add task progress visualization
- Mobile responsive UI

**Testing**
- Unit tests for orchestration logic
- Integration tests for API routes
- End-to-end tests for task flow

## Getting Started

1. Fork the repo
2. Clone your fork
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and fill in values
5. Set up database: `npm run db:setup`
6. Start server: `npm run dev`

## Code Style

- ES modules (import/export)
- Async/await for promises
- Descriptive variable names
- Comments for non-obvious logic
- Keep functions small and focused

## Pull Request Process

1. Create a branch for your feature
2. Make your changes
3. Test locally
4. Submit PR with description of changes
5. Wait for review

## Questions?

Open an issue or reach out on Discord.
