# UN-61 Clean README Installation Validation

## Scope

This validation used a newly cloned `origin/master` checkout at commit `61c3d60b70e7b52d4b35934cfe1c9bdb1b8607ca`. The clone began without a local environment file, installed dependencies, build output, generated Git MCP environment, packet captures, or inherited project artifacts.

The README was the only operational guide used for the checked steps. The temporary clone and its local resources are not part of the repository evidence.

## Environment prerequisites

- Node.js 22.22.2 and npm 10.9.7.
- Docker Desktop with Engine 28.3.0.
- Git 2.52.0 and Python 3.13.6.
- A manually supplied local DeepSeek configuration for the temporary clone. Its values were not read, copied, printed, or versioned.

## README validation results

| README flow | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Passed | Dependencies installed in the clean clone. |
| `npm run git:mcp:setup` | Passed | The isolated Python environment and nested Git repository were created. |
| `npm run db:up` | Passed | The local PostgreSQL container became healthy. |
| Prisma generation, migration, seed, and verification | Passed | `db:verify` confirmed the canonical Tienda Demo dataset. |
| Local dashboard Finance read | Passed | `GET /api/dashboard` returned a valid Finance section from the local runtime. |
| Remote Finance smoke | Passed | The documented public remote configuration completed a 24-tool read-only smoke through Streamable HTTP. |
| General Web chat | Blocked | The documented DeepSeek smoke returned `CONFIGURATION_ERROR`. |
| Financial Web chat | Blocked | The Host cannot initialize while DeepSeek configuration is invalid. |
| Filesystem and Git demo | Blocked | The demo requires the same DeepSeek configuration, although its setup completed. |

## README findings

No missing or incorrect README command was discovered in the completed installation, database, local dashboard, Git MCP setup, or remote Finance validation flows.

The blocked flows are caused by the temporary clone's local DeepSeek configuration. This is an external prerequisite, not a versioned README defect. The configuration values remain intentionally outside the audit record.

## Safety and limits

- No remote Finance write, remote database access, or remote reset was performed.
- No secret, environment-file content, session identifier, private URL, or payload was recorded.
- The Git MCP setup remained limited to its documented nested repository and did not push to a remote.
- The temporary clone must be recreated after correcting its local DeepSeek configuration before UN-61 can be marked complete.

## Current assessment

The clean installation and read-only Finance paths are validated. UN-61 remains incomplete until a newly cloned environment completes both a general Web chat and a financial Web chat with a valid local DeepSeek configuration, followed by the documented Filesystem and Git demonstration.
