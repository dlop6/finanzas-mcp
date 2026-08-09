# Finanza MCP

University networking project: a Next.js web chatbot acting as an MCP Host and connecting to a custom Finance MCP through manual MCP/JSON-RPC messages.

## Requirements

- Node.js 24.14 or compatible
- npm

PostgreSQL and service-specific environment variables will be added in later tickets. Do not commit real `.env` files or secrets.

## Install

```bash
npm ci
```

## Development

```bash
npm run dev
```

Open <http://localhost:3000>.

## Quality checks

```bash
npm test
npm run test:watch
npm run typecheck
npm run lint
npm run build
```

`npm test` runs Vitest once in a non-interactive mode. The current smoke test renders the existing synchronous Next.js Home component with React Testing Library.
